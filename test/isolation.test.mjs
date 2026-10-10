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
  {
    name: "propositions", mode: "insert",
    seed: (u) => ({ cible: "protection", operation: "modifier", apres: { prevoyance: true, marqueur: `prop-${u.id}` }, source: `essai ${u.label}` }),
    match: (u, row) => ({ id: row.id }),
    field: "source", patch: { source: "piraté" },
    foreign: (b) => ({ user_id: b.id, cible: "protection", operation: "modifier", apres: { prevoyance: false }, source: "intrus" }),
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

  describe("annoter_instrument() (RPC security definer, colonnes d'annotation des instruments)", () => {
    it("refusée pour un ISIN que l'appelant ne détient pas, acceptée pour un ISIN détenu, cours intouché", async (tc) => {
      if (skipIfNoKey(tc)) return;
      // L'instrument doit exister (clé étrangère de positions.isin) : request_instrument est idempotente.
      const pre = await admin.from("instruments").select("isin, price, ter, zone, devise, annote_source, annote_le").eq("isin", TEST_ISIN).maybeSingle();
      assert.equal(pre.error, null, `instruments : lecture préalable impossible (${pre.error?.message})`);
      if (!pre.data) instrumentPreexisted = false;
      const req = await A.client.rpc("request_instrument", { p_isin: TEST_ISIN, p_name: "Test", p_symbol: null });
      assert.equal(req.error, null, `request_instrument : ${req.error?.message}`);
      if (!pre.data) instrumentCreated = true;
      const annot = { p_isin: TEST_ISIN, p_ter: 0.6, p_zone: "États-Unis", p_devise: "usd", p_source: "https://example.org/dic-test.pdf" };
      let extra = null;
      try {
        // Ni A ni B ne détiennent encore cet ISIN : refus pour les deux.
        for (const u of [A, B]) {
          const { error } = await u.client.rpc("annoter_instrument", annot);
          assert.ok(error, `annoter_instrument : ${u.label} ne détient pas ${TEST_ISIN}, l'appel doit être refusé`);
          assert.match(error.message, /non détenu/, `annoter_instrument : motif du refus (${error.message})`);
        }
        // A ouvre une ligne sur cet ISIN : l'annotation passe, sourcée et datée.
        const ins = await A.client.from("positions").insert({ name: "ETF test", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "market", isin: TEST_ISIN, qty: 1 }).select().single();
        assert.equal(ins.error, null, `positions : A doit pouvoir créer une ligne cotée (${ins.error?.message})`);
        extra = ins.data.id;
        const sans = await A.client.rpc("annoter_instrument", { ...annot, p_source: "  " });
        assert.ok(sans.error && /source requise/.test(sans.error.message), "annoter_instrument : la source est obligatoire");
        const hors = await A.client.rpc("annoter_instrument", { ...annot, p_ter: 12 });
        assert.ok(hors.error && /TER invalide/.test(hors.error.message), "annoter_instrument : TER borné à 0..10");
        const { data, error } = await A.client.rpc("annoter_instrument", annot);
        assert.equal(error, null, `annoter_instrument : A détient ${TEST_ISIN}, l'appel doit réussir (${error?.message})`);
        assert.equal(Number(data.ter), 0.6);
        assert.equal(data.zone, "États-Unis");
        assert.equal(data.devise, "USD", "devise normalisée en majuscules");
        assert.equal(data.annote_source, annot.p_source);
        assert.ok(data.annote_le, "date d'annotation renseignée");
        assert.equal(data.price ?? null, pre.data?.price ?? null, "le cours n'est pas modifiable par cette RPC");
        // B ne détient toujours pas l'ISIN : toujours refusé, mais l'annotation (donnée publique du fonds) lui est visible.
        const refus = await B.client.rpc("annoter_instrument", { ...annot, p_ter: 0.01 });
        assert.ok(refus.error, "annoter_instrument : B reste refusé");
        const vu = await B.client.from("instruments").select("ter, annote_source").eq("isin", TEST_ISIN).single();
        assert.equal(vu.error, null);
        assert.equal(Number(vu.data.ter), 0.6, "B voit le TER annoté par A (instrument partagé), pas celui qu'il a tenté d'écrire");
        // Écriture directe toujours interdite.
        const direct = await A.client.from("instruments").update({ ter: 0.01 }).eq("isin", TEST_ISIN).select();
        assert.ok(direct.error, "instruments : la mise à jour directe du TER par un utilisateur doit échouer");
      } finally {
        if (extra) await A.client.from("positions").delete().eq("id", extra); // export_all attend une seule position pour A
        if (pre.data) { // instrument réel préexistant : on restaure ses annotations
          const { ter, zone, devise, annote_source, annote_le } = pre.data;
          await admin.from("instruments").update({ ter, zone, devise, annote_source, annote_le }).eq("isin", TEST_ISIN);
        }
      }
    });
  });

  describe("appliquer_propositions() / refuser_propositions() (RPC security invoker)", () => {
    it("A ne peut ni appliquer ni refuser les propositions de B ; B applique les siennes", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const propB = B.rows.propositions.id;
      const before = await B.client.from("profiles").select("protection").eq("user_id", B.id).single();
      assert.equal(before.error, null);
      const ap = await A.client.rpc("appliquer_propositions", { p_ids: [propB], p_modifications: {} });
      assert.equal(ap.error, null, `appliquer_propositions : l'appel par A ne doit pas échouer (${ap.error?.message})`);
      assert.equal(ap.data, 0, "A n'applique aucune proposition de B");
      const rf = await A.client.rpc("refuser_propositions", { p_ids: [propB] });
      assert.equal(rf.error, null); assert.equal(rf.data, 0, "A ne refuse aucune proposition de B");
      const vu = await B.client.from("propositions").select("statut, decide_le").eq("id", propB).single();
      assert.equal(vu.data.statut, "en_attente", "la proposition de B reste en attente");
      const after = await B.client.from("profiles").select("protection").eq("user_id", B.id).single();
      assert.deepEqual(after.data.protection, before.data.protection, "les données de B sont inchangées");
      // B l'applique avec une valeur modifiée : seule la protection de B change.
      const own = await B.client.rpc("appliquer_propositions", { p_ids: [propB], p_modifications: { [propB]: { prevoyance: true, emprunteur: true } } });
      assert.equal(own.error, null, `appliquer_propositions : B applique la sienne (${own.error?.message})`);
      assert.equal(own.data, 1);
      const pB = await B.client.from("profiles").select("protection").eq("user_id", B.id).single();
      assert.equal(pB.data.protection.prevoyance, true); assert.equal(pB.data.protection.emprunteur, true);
      const st = await B.client.from("propositions").select("statut, decide_le, apres").eq("id", propB).single();
      assert.equal(st.data.statut, "acceptee"); assert.ok(st.data.decide_le);
      assert.deepEqual(st.data.apres, { prevoyance: true, emprunteur: true }, "apres garde la valeur appliquée");
      // Une cible invalide : tout est annulé, message en français.
      const bad = await A.client.from("propositions").insert({ cible: "budget", operation: "creer", apres: { type: "salaire", montant: 1 }, source: "essai" }).select("id").single();
      assert.equal(bad.error, null);
      const ko = await A.client.rpc("appliquer_propositions", { p_ids: [bad.data.id] });
      assert.ok(ko.error && /Proposition non appliquée \(ligne de budget, creer\)/.test(ko.error.message), `message français (${ko.error?.message})`);
      const rA = await A.client.rpc("refuser_propositions", { p_ids: [bad.data.id] });
      assert.equal(rA.data, 1, "A refuse la sienne");
      await A.client.from("propositions").delete().eq("id", bad.data.id); // export_all : une seule proposition par compte
    });
  });

  describe("export_all()", () => {
    it("ne renvoie que les données de A", async (tc) => {
      if (skipIfNoKey(tc)) return;
      // Colonnes du Diagnostic : écrites par A, exportées pour A seulement, invisibles pour B.
      const diag = { risque: { profil: "equilibre", score: 55, date: today, marqueur: `risque-${A.id}` }, classes: { Protection: "fonds_euros" }, protection: { prevoyance: true, emprunteur: false } };
      const up = await A.client.from("profiles").update(diag).eq("user_id", A.id).select("risque, classes, protection").single();
      assert.equal(up.error, null, `profiles : A doit pouvoir écrire risque / classes / protection (${up.error?.message})`);
      const volB = await B.client.from("profiles").select("user_id, risque, classes, protection");
      assert.equal(volB.error, null);
      assert.ok(volB.data.every((r) => r.user_id === B.id), "profiles : B ne lit que son profil");
      assert.ok(!JSON.stringify(volB.data).includes(`risque-${A.id}`), "profiles : le profil de risque de A est invisible pour B");
      const { data, error } = await A.client.rpc("export_all");
      assert.equal(error, null, `export_all : l'appel par A doit réussir (${error?.message})`);
      assert.ok(data && typeof data === "object", "export_all : doit renvoyer un objet");
      for (const k of ["profile", "biens", "credits", "positions", "transactions", "snapshots", "config", "status", "budget", "objectifs", "propositions"]) {
        assert.ok(k in data, `export_all : la clé ${k} doit être présente`);
      }
      assert.equal(data.profile?.user_id, A.id, "export_all : le profil exporté doit être celui de A");
      for (const k of ["risque", "classes", "protection"]) assert.deepEqual(data.profile[k], diag[k], `export_all : profile.${k} de A exporté`);
      const exB = await B.client.rpc("export_all");
      assert.equal(exB.error, null);
      assert.ok(!JSON.stringify(exB.data).includes(`risque-${A.id}`), "export_all : l'export de B ne contient pas le profil de risque de A");
      assert.ok("risque" in exB.data.profile && "classes" in exB.data.profile && "protection" in exB.data.profile, "export_all : colonnes du Diagnostic présentes pour B aussi");
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
