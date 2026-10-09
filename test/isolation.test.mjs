// Test d'isolation RLS : deux comptes A et B, chaque table privée, lectures et écritures croisées.
//
// Nécessite la clé service dans SUPABASE_SERVICE_KEY (création de comptes confirmés, nettoyage).
// Sans elle, chaque test est sauté (jamais en échec) : la CI publique n'a pas la clé.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  hasServiceKey, SKIP_REASON, adminClient, createTestUser, deleteTestUser,
} from "./helpers/supabase.mjs";

const SKIP = !hasServiceKey;
const skipIfNoKey = (t) => { if (SKIP) { t.skip(SKIP_REASON); return true; } return false; };

const today = new Date().toISOString().slice(0, 10);
const TEST_ISIN = "FR0010342592";

// Description de chaque table privée : comment semer une ligne, la retrouver, la modifier,
// quel champ observer, et comment tenter une insertion au nom d'un autre utilisateur.
const TABLES = [
  {
    name: "profiles", mode: "upsert",
    seed: (u) => ({ user_id: u.id, foyer: { adultes: 1, marqueur: `A-${u.id}` } }),
    match: (u) => ({ user_id: u.id }),
    field: "foyer", patch: { foyer: { pirate: true } },
    foreign: (b) => ({ user_id: b.id }),
  },
  {
    name: "biens", mode: "insert",
    seed: () => ({ nom: "Résidence", usage: "rp", valeur: 100000, part_p1: 100 }),
    match: (u, row) => ({ id: row.id }),
    field: "nom", patch: { nom: "piraté" },
    foreign: (b) => ({ user_id: b.id, nom: "intrus" }),
  },
  {
    name: "credits", mode: "insert",
    seed: () => ({ nom: "Prêt auto", owner: "p1", crd: 5000, mensualite: 200 }),
    match: (u, row) => ({ id: row.id }),
    field: "nom", patch: { nom: "piraté" },
    foreign: (b) => ({ user_id: b.id, nom: "intrus" }),
  },
  {
    name: "positions", mode: "insert",
    seed: () => ({ name: "Livret", envelope: "Livret A", owner: "p1", bloc: "Épargne", mode: "manual", value: 1000, value_date: today }),
    match: (u, row) => ({ id: row.id }),
    field: "name", patch: { name: "piraté" },
    foreign: (b) => ({ user_id: b.id, name: "intrus", mode: "manual" }),
  },
  {
    name: "transactions", mode: "insert",
    seed: (u, rows) => ({ position_id: rows.positions.id, date: today, type: "versement", amount: 100, note: "seed", source: "manuel" }),
    match: (u, row) => ({ id: row.id }),
    field: "note", patch: { note: "piraté" },
    foreign: (b) => ({ user_id: b.id, type: "versement", amount: 1 }),
  },
  {
    name: "snapshots", mode: "insert",
    seed: () => ({ date: today, total: 1000, p1: 1000, p2: 0, source: "test" }),
    match: (u) => ({ user_id: u.id, date: today }),
    field: "total", patch: { total: 999999 },
    foreign: (b) => ({ user_id: b.id, date: "2000-01-01", total: 1 }),
  },
  {
    name: "config", mode: "upsert",
    seed: (u) => ({ user_id: u.id, todo: [`todo-${u.id}`] }),
    match: (u) => ({ user_id: u.id }),
    field: "todo", patch: { todo: ["piraté"] },
    foreign: (b) => ({ user_id: b.id }),
  },
  {
    name: "status", mode: "upsert",
    seed: (u) => ({ user_id: u.id, summary: `statut-${u.id}`, missing_prices: 0 }),
    match: (u) => ({ user_id: u.id }),
    field: "summary", patch: { summary: "piraté" },
    foreign: (b) => ({ user_id: b.id, summary: "intrus" }),
  },
  {
    name: "budgets", mode: "upsert",
    seed: (u) => ({ user_id: u.id, lignes: [{ id: `l-${u.id}`, type: "depense", categorie: "Logement", libelle: "Charges", montant: 150, frequence: "mois" }] }),
    match: (u) => ({ user_id: u.id }),
    field: "lignes", patch: { lignes: [] },
    foreign: (b) => ({ user_id: b.id }),
  },
  {
    name: "objectifs", mode: "insert",
    seed: () => ({ nom: "Apport", type: "apport", cible: 50000, date_cible: "2030-01-01", deja: 1000, source: "poches", poches: ["Épargne"], rendement: 2.4, priorite: 1 }),
    match: (u, row) => ({ id: row.id }),
    field: "nom", patch: { nom: "piraté" },
    foreign: (b) => ({ user_id: b.id, nom: "intrus" }),
  },
];

const PRIVATE_TABLES = TABLES.map((t) => t.name);
// Clés de export_all() qui portent une seule ligne (objet ou null) plutôt qu'un tableau.
const EXPORT_SINGLE = { profiles: "profile", budgets: "budget" };
const withMatch = (query, match) => Object.entries(match).reduce((q, [k, v]) => q.eq(k, v), query);
const isRlsError = (e) => /row-level security|violates|permission/i.test(e?.message || "");

/** Sème une ligne par table privée pour l'utilisateur `u` ; renvoie `{ table: row }`. */
async function seedUser(u) {
  const rows = {};
  for (const t of TABLES) {
    const payload = t.seed(u, rows);
    const q = t.mode === "upsert"
      ? u.client.from(t.name).upsert(payload, { onConflict: "user_id" })
      : u.client.from(t.name).insert(payload);
    const { data, error } = await q.select().single();
    assert.equal(error, null, `${t.name} : ${u.label} n'a pas pu créer sa propre ligne (${error?.message})`);
    assert.equal(data.user_id, u.id, `${t.name} : la ligne créée par ${u.label} doit porter son user_id`);
    rows[t.name] = data;
  }
  return rows;
}

async function readOwn(u, t) {
  const { data, error } = await withMatch(u.client.from(t.name).select("*"), t.match(u, u.rows[t.name])).maybeSingle();
  assert.equal(error, null, `${t.name} : ${u.label} doit pouvoir relire sa ligne (${error?.message})`);
  return data;
}

describe("isolation RLS entre deux comptes", () => {
  let admin, A, B;
  let instrumentPreexisted = false;
  let instrumentCreated = false;

  before(async () => {
    if (SKIP) return;
    admin = adminClient();
    A = { label: "A", ...(await createTestUser("a")) };
    B = { label: "B", ...(await createTestUser("b")) };
    A.rows = await seedUser(A);
    B.rows = await seedUser(B);
    A.positionId = A.rows.positions.id;
    B.positionId = B.rows.positions.id;
  });

  after(async () => {
    if (SKIP) return;
    const errors = [];
    for (const u of [B, A]) {
      if (!u?.id) continue;
      try { await deleteTestUser(u.id); } catch (e) { errors.push(e.message); }
    }
    if (instrumentCreated && !instrumentPreexisted) {
      const { error } = await admin.from("instruments").delete().eq("isin", TEST_ISIN);
      if (error) errors.push(`instrument ${TEST_ISIN} : ${error.message}`);
    }
    assert.deepEqual(errors, [], `nettoyage incomplet : ${errors.join(" ; ")}`);
  });

  for (const t of TABLES) {
    describe(t.name, () => {
      it("A ne lit que ses propres lignes", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const { data, error } = await A.client.from(t.name).select("*");
        assert.equal(error, null, `${t.name} : la lecture de A ne doit pas échouer (${error?.message})`);
        assert.equal(data.length, 1, `${t.name} : A doit voir exactement une ligne (la sienne)`);
        assert.ok(data.every((r) => r.user_id === A.id), `${t.name} : toutes les lignes lues par A doivent porter user_id = A`);
        assert.ok(!data.some((r) => r.user_id === B.id), `${t.name} : A ne doit voir aucune ligne de B`);
        if (B.rows[t.name].id) {
          assert.ok(!data.some((r) => r.id === B.rows[t.name].id), `${t.name} : A ne doit pas voir la ligne ${B.rows[t.name].id} de B`);
        }
      });

      it("A ne peut pas modifier la ligne de B", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const { data, error } = await withMatch(A.client.from(t.name).update(t.patch), t.match(B, B.rows[t.name])).select();
        if (error) {
          assert.ok(isRlsError(error), `${t.name} : l'erreur de mise à jour doit être une erreur de droits (${error.message})`);
        } else {
          assert.equal(data.length, 0, `${t.name} : la mise à jour de A sur la ligne de B ne doit toucher aucune ligne`);
        }
        const after = await readOwn(B, t);
        assert.ok(after, `${t.name} : la ligne de B doit toujours exister après la tentative de A`);
        assert.deepEqual(after[t.field], B.rows[t.name][t.field], `${t.name} : le champ ${t.field} de B ne doit pas avoir changé`);
      });

      it("A ne peut pas supprimer la ligne de B", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const { data, error } = await withMatch(A.client.from(t.name).delete(), t.match(B, B.rows[t.name])).select();
        if (error) {
          assert.ok(isRlsError(error), `${t.name} : l'erreur de suppression doit être une erreur de droits (${error.message})`);
        } else {
          assert.equal(data.length, 0, `${t.name} : la suppression de A sur la ligne de B ne doit toucher aucune ligne`);
        }
        const after = await readOwn(B, t);
        assert.ok(after, `${t.name} : la ligne de B doit toujours exister après la tentative de suppression par A`);
        assert.equal(after.user_id, B.id, `${t.name} : la ligne relue par B doit bien être la sienne`);
      });

      it("A ne peut pas insérer une ligne au nom de B", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const { error } = await A.client.from(t.name).insert(t.foreign(B)).select();
        assert.ok(error, `${t.name} : l'insertion avec user_id = B par A doit échouer`);
        assert.match(error.message, /row-level security|violates|permission/i, `${t.name} : l'erreur doit être une violation RLS`);
        const { data: asB, error: errB } = await B.client.from(t.name).select("*");
        assert.equal(errB, null, `${t.name} : B doit pouvoir relire ses lignes (${errB?.message})`);
        assert.equal(asB.length, 1, `${t.name} : B ne doit toujours avoir qu'une seule ligne (rien inséré par A)`);
      });
    });
  }

  describe("instruments (table partagée)", () => {
    it("A peut lire les instruments", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const { data, error } = await A.client.from("instruments").select("isin").limit(5);
      assert.equal(error, null, `instruments : la lecture par A ne doit pas échouer (${error?.message})`);
      assert.ok(Array.isArray(data), "instruments : la lecture doit renvoyer un tableau");
    });

    it("A ne peut pas modifier un prix", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const { error } = await A.client.from("instruments").update({ price: 1 }).eq("isin", TEST_ISIN).select();
      assert.ok(error, "instruments : la mise à jour du prix par un utilisateur doit échouer");
      assert.match(error.message, /permission|denied|row-level security/i, `instruments : l'erreur doit être un refus de droits (${error.message})`);
    });

    it("request_instrument fonctionne et le résultat est visible par B", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const pre = await admin.from("instruments").select("isin").eq("isin", TEST_ISIN).maybeSingle();
      assert.equal(pre.error, null, `instruments : vérification préalable impossible (${pre.error?.message})`);
      instrumentPreexisted = Boolean(pre.data);

      const { data, error } = await A.client.rpc("request_instrument", { p_isin: TEST_ISIN, p_name: "Test", p_symbol: "LQQ.PA" });
      assert.equal(error, null, `request_instrument : l'appel par A doit réussir (${error?.message})`);
      instrumentCreated = true;
      assert.equal(data?.isin, TEST_ISIN, "request_instrument : doit renvoyer la ligne avec l'isin demandé");

      const seen = await B.client.from("instruments").select("isin, name").eq("isin", TEST_ISIN).maybeSingle();
      assert.equal(seen.error, null, `instruments : la lecture par B ne doit pas échouer (${seen.error?.message})`);
      assert.equal(seen.data?.isin, TEST_ISIN, "instruments : B doit voir l'instrument demandé par A");
    });
  });

  describe("export_all()", () => {
    it("ne renvoie que les données de A", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const { data, error } = await A.client.rpc("export_all");
      assert.equal(error, null, `export_all : l'appel par A doit réussir (${error?.message})`);
      assert.ok(data && typeof data === "object", "export_all : doit renvoyer un objet");
      for (const k of ["profile", "biens", "credits", "positions", "transactions", "snapshots", "config", "status", "budget", "objectifs"]) {
        assert.ok(k in data, `export_all : la clé ${k} doit être présente`);
      }
      assert.equal(data.profile?.user_id, A.id, "export_all : le profil exporté doit être celui de A");
      assert.equal(data.positions.length, 1, "export_all : A doit avoir exactement une position");
      assert.equal(data.positions[0].id, A.positionId, "export_all : la position exportée doit être celle de A");
      const json = JSON.stringify(data);
      assert.ok(!json.includes(B.id), "export_all : l'export de A ne doit contenir aucune référence à l'identifiant de B");
      assert.ok(!json.includes(B.positionId), "export_all : l'export de A ne doit pas contenir la position de B");
      assert.equal(data.budget?.user_id, A.id, "export_all : le budget exporté doit être celui de A");
      assert.deepEqual(data.budget.lignes, A.rows.budgets.lignes, "export_all : les lignes du budget de A");
      assert.equal(data.objectifs.length, 1, "export_all : A doit avoir exactement un objectif");
      assert.equal(data.objectifs[0].id, A.rows.objectifs.id, "export_all : l'objectif exporté doit être celui de A");
      assert.ok(!json.includes(B.rows.objectifs.id), "export_all : l'export de A ne doit pas contenir l'objectif de B");
      for (const key of PRIVATE_TABLES.filter((n) => !(n in EXPORT_SINGLE))) {
        assert.ok(Array.isArray(data[key]), `export_all : ${key} doit être un tableau`);
        assert.ok(data[key].every((r) => r.user_id === A.id), `export_all : ${key} ne doit contenir que des lignes de A`);
      }
    });
  });

  describe("job_runs (table service)", () => {
    it("A ne peut pas lire job_runs", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const { error } = await A.client.from("job_runs").select("*");
      assert.ok(error, "job_runs : la lecture par un utilisateur doit être refusée");
    });
  });

  describe("delete_me()", () => {
    it("supprime le compte de A et ses données en cascade", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const { error } = await A.client.rpc("delete_me");
      assert.equal(error, null, `delete_me : l'appel par A doit réussir (${error?.message})`);

      const lookup = await admin.auth.admin.getUserById(A.id);
      assert.ok(lookup.error || !lookup.data?.user, "delete_me : le compte de A ne doit plus exister côté Auth");

      for (const name of PRIVATE_TABLES) {
        const { data, error: e } = await admin.from(name).select("user_id").eq("user_id", A.id);
        assert.equal(e, null, `${name} : la vérification admin ne doit pas échouer (${e?.message})`);
        assert.equal(data.length, 0, `${name} : aucune ligne de A ne doit subsister après delete_me (cascade)`);
      }

      const { data: bPos, error: eB } = await B.client.from("positions").select("id");
      assert.equal(eB, null, `positions : B doit pouvoir relire ses positions (${eB?.message})`);
      assert.deepEqual(bPos.map((r) => r.id), [B.positionId], "delete_me : les données de B doivent être intactes");
      A.id = null; // déjà supprimé : le nettoyage ne doit pas réessayer
    });
  });
});
