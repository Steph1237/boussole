// Test d'isolation RLS : deux comptes A et B, chaque table privée, lectures et écritures croisées.
//
// Nécessite la clé service dans SUPABASE_SERVICE_KEY (création de comptes confirmés, nettoyage).
// Sans elle, chaque test est sauté (jamais en échec) : la CI publique n'a pas la clé.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  hasServiceKey, SKIP_REASON, adminClient, userClient, createTestUser, createTestUserAal2, deleteTestUser, erreurMasquee,
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
  {
    name: "connexions_assistant", mode: "insert",
    seed: (u) => ({ client_id: `client-${u.label}`, client_nom: `Assistant ${u.label}` }),
    match: (u, row) => ({ user_id: u.id, client_id: row.client_id }),
    field: "appels", patch: { appels: 999 },
    foreign: (b) => ({ user_id: b.id, client_id: "intrus" }),
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

  describe("noter_connexion() (RPC security invoker, écriture limitée à une toutes les 5 minutes)", () => {
    it("n'écrit que pour l'appelant, une seule fois par fenêtre de 5 minutes", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const lire = async (u) => {
        const { data, error } = await u.client.from("connexions_assistant").select("client_id, client_nom, appels, dernier_le").eq("client_id", "test-onboarding");
        assert.equal(error, null, `connexions_assistant : lecture par ${u.label} (${error?.message})`);
        return data;
      };
      try {
        for (let i = 0; i < 3; i++) {
          const { error } = await A.client.rpc("noter_connexion", { p_client_id: "test-onboarding", p_client_nom: "Test" });
          assert.equal(error, null, `noter_connexion : appel ${i + 1} par A (${error?.message})`);
        }
        const rowsA = await lire(A);
        assert.equal(rowsA.length, 1, "une ligne pour A");
        assert.equal(rowsA[0].appels, 1, "trois appels rapprochés : une seule écriture");
        assert.equal(rowsA[0].client_nom, "Test");
        assert.deepEqual(await lire(B), [], "B ne voit pas la connexion de A");
        // Fenêtre de 5 minutes écoulée : l'appel suivant met à jour la ligne.
        const vieux = new Date(Date.now() - 6 * 60000).toISOString();
        const up = await admin.from("connexions_assistant").update({ dernier_le: vieux }).eq("user_id", A.id).eq("client_id", "test-onboarding");
        assert.equal(up.error, null);
        const again = await A.client.rpc("noter_connexion", { p_client_id: "test-onboarding", p_client_nom: null });
        assert.equal(again.error, null);
        const apres = await lire(A);
        assert.equal(apres[0].appels, 2, "nouvelle écriture après 5 minutes");
        assert.equal(apres[0].client_nom, "Test", "nom conservé quand il n'est pas fourni");
        assert.ok(Date.parse(apres[0].dernier_le) > Date.parse(vieux));
        const anon = await userClient().rpc("noter_connexion", { p_client_id: "x", p_client_nom: null });
        assert.ok(anon.error, "noter_connexion : refusée sans session");
      } finally {
        await A.client.from("connexions_assistant").delete().eq("client_id", "test-onboarding"); // export_all : une seule connexion pour A
      }
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
      for (const k of ["profile", "biens", "credits", "positions", "transactions", "snapshots", "config", "status", "budget", "objectifs", "propositions", "connexions_assistant"]) {
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

// ---------------------------------------------------------------------------------------------------------------------------------
// HIS2 (migration 0034) : les cinq tables de l'historique importé. Les quatre tables de relevés et d'imports suivent le régime des tables
// banque_* (0028, 0033) : fermées à toute session aal1, ouvertes au propriétaire en aal2 ; photos_reconstituees suit « aal2 si facteur » et
// n'est écrite que par le service. Les comptes ci-dessous ont donc un facteur TOTP vérifié (session aal2) : un compte sans facteur ne
// pourrait ni lire ni écrire les tables du régime bancaire.
// ---------------------------------------------------------------------------------------------------------------------------------
describe("isolation RLS : tables de l'historique importé (comptes à double authentification)", () => {
  let admin, A, B;
  const empreinte = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  // clé d'un compte : jamais de suite de 6 chiffres (0034, contrainte historique_comptes_cle) ; un uuid en contient souvent, d'où les lettres
  const sansChiffres = id => id.replace(/[0-9]/g, c => "ghijklmnop"[c]);

  /** Sème, par le client aal2 du compte, un compte importé, son import, un mois et ses catégories ; par le service, une photo. */
  async function seed(u) {
    u.compteId = randomUUID(); u.importId = randomUUID();
    const steps = [
      ["historique_comptes", { id: u.compteId, libelle: `Compte ${u.label}`, etablissement: "lcl", type: "courant", titulaire: "p1", cle: `cle-${u.label}-${sansChiffres(u.compteId)}` }],
      ["historique_imports", { id: u.importId, type: "releves", empreinte: empreinte(), etablissement: "lcl", compte_id: u.compteId, periode_du: "2024-01-01", periode_au: "2024-01-31", source: `essai ${u.label}` }],
      ["historique_releves", { compte_id: u.compteId, mois: "2024-01-01", complet: true, total_entrees: 100, total_sorties: 40, nombre: 3, import_id: u.importId }],
      ["historique_banque_mois", { compte_id: u.compteId, mois: "2024-01-01", categorie: "divers", sous_categorie: "", entrees: 0, sorties: 40, nombre: 3 }],
    ];
    for (const [table, row] of steps) {
      const { error } = await u.client.from(table).insert(row);
      assert.equal(error, null, `${table} : ${u.label} doit pouvoir écrire ses propres lignes en aal2 (${error?.message})`);
    }
    const ph = await admin.from("photos_reconstituees").insert({ user_id: u.id, mois: "2024-01-01", date: "2024-01-31", total: 1000, p1: 1000, p2: 0, financier: 1000, net: 1000,
      qualite: "estime", part_estimee: 1, methode: "historique@2" });
    assert.equal(ph.error, null, `photos_reconstituees : le service écrit (${ph.error?.message})`);
  }

  // Description de chaque table : comment retrouver la ligne d'un compte, le champ à observer, la modification tentée, une insertion au nom de l'autre.
  const T = [
    { name: "historique_comptes", match: u => ({ id: u.compteId }), field: "libelle", patch: { libelle: "piraté" },
      foreign: b => ({ user_id: b.id, libelle: "intrus", etablissement: "lcl", type: "courant", titulaire: "p1", cle: `intrus-${sansChiffres(randomUUID())}` }) },
    { name: "historique_imports", match: u => ({ id: u.importId }), field: "source", patch: { source: "piraté" },
      foreign: b => ({ user_id: b.id, type: "ordres", empreinte: empreinte(), etablissement: "lcl", periode_du: "2024-01-01", periode_au: "2024-01-02", source: "intrus" }) },
    { name: "historique_releves", match: u => ({ compte_id: u.compteId, mois: "2024-01-01" }), field: "total_sorties", patch: { total_sorties: 999 },
      foreign: b => ({ user_id: b.id, compte_id: b.compteId, mois: "2024-02-01", complet: true, total_entrees: 1, total_sorties: 1, import_id: b.importId }) },
    { name: "historique_banque_mois", match: u => ({ compte_id: u.compteId, mois: "2024-01-01" }), field: "sorties", patch: { sorties: 999 },
      foreign: b => ({ user_id: b.id, compte_id: b.compteId, mois: "2024-01-01", categorie: "logement", sorties: 1 }) },
    { name: "photos_reconstituees", match: u => ({ user_id: u.id, mois: "2024-01-01" }), field: "total", patch: { total: 1 },
      foreign: b => ({ user_id: b.id, mois: "2024-02-01", date: "2024-02-29", total: 1, p1: 1, p2: 0, financier: 1, net: 1, qualite: "estime", part_estimee: 1, methode: "x" }) },
  ];

  before(async () => {
    if (SKIP) return;
    admin = adminClient();
    A = { label: "A", ...(await createTestUserAal2("his-a")) };
    B = { label: "B", ...(await createTestUserAal2("his-b")) };
    await seed(A);
    await seed(B);
  });

  after(async () => {
    if (SKIP) return;
    const errors = [];
    for (const u of [B, A]) {
      if (!u?.id) continue;
      try { await deleteTestUser(u.id); } catch (e) { errors.push(e.message); }
    }
    assert.deepEqual(errors, [], `nettoyage incomplet : ${errors.join(" ; ")}`);
  });

  for (const t of T) {
    describe(t.name, () => {
      it("A (aal2) ne lit que ses propres lignes", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const { data, error } = await A.client.from(t.name).select("*");
        assert.equal(error, null, `${t.name} : la lecture de A ne doit pas échouer (${error?.message})`);
        assert.equal(data.length, 1, `${t.name} : A doit voir exactement une ligne (la sienne)`);
        assert.ok(data.every((r) => r.user_id === A.id), `${t.name} : toutes les lignes lues par A doivent porter user_id = A`);
      });

      it("A en aal1 (mot de passe seul, facteur vérifié) ne voit rien", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const c = await A.nouvelleSessionAal1();
        const { data, error } = await c.from(t.name).select("*");
        assert.equal(error, null, `${t.name} : la lecture en aal1 renvoie une liste vide, pas une erreur (${error?.message})`);
        assert.deepEqual(data, [], `${t.name} : A en aal1 ne doit voir aucune ligne`);
        const { data: adm } = await admin.from(t.name).select("user_id").eq("user_id", A.id);
        assert.equal(adm.length, 1, `${t.name} : la ligne de A existe bien (le service la voit)`);
      });

      it("A ne peut pas modifier ni supprimer la ligne de B", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const upd = await withMatch(A.client.from(t.name).update(t.patch), t.match(B)).select();
        if (upd.error) assert.ok(isRlsError(upd.error), `${t.name} : erreur de droits attendue (${upd.error.message})`);
        else assert.equal(upd.data.length, 0, `${t.name} : la mise à jour de A sur la ligne de B ne doit toucher aucune ligne`);
        const del = await withMatch(A.client.from(t.name).delete(), t.match(B)).select();
        if (del.error) assert.ok(isRlsError(del.error), `${t.name} : erreur de droits attendue (${del.error.message})`);
        else assert.equal(del.data.length, 0, `${t.name} : la suppression de A sur la ligne de B ne doit toucher aucune ligne`);
        const { data } = await withMatch(admin.from(t.name).select("*"), t.match(B)).single();
        assert.ok(data, `${t.name} : la ligne de B existe encore`);
        const propre = await withMatch(B.client.from(t.name).select("*"), t.match(B)).single();
        assert.equal(propre.error, null, `${t.name} : B relit sa ligne (${propre.error?.message})`);
        assert.deepEqual(propre.data[t.field], data[t.field], `${t.name} : B relit la même valeur que le service`);
        assert.notDeepEqual(data[t.field], t.patch[t.field], `${t.name} : ${t.field} de B n'a pas reçu la valeur de A`);
      });

      it("A ne peut pas insérer une ligne au nom de B", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const { error } = await A.client.from(t.name).insert(t.foreign(B)).select();
        assert.ok(error, `${t.name} : l'insertion avec user_id = B par A doit échouer`);
        assert.match(error.message, /row-level security|violates|permission/i, `${t.name} : l'erreur doit être un refus de droits`);
      });
    });
  }

  describe("photos_reconstituees : écriture réservée au service", () => {
    it("A (aal2) ne peut ni insérer, ni modifier, ni supprimer ses propres photos", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const ins = await A.client.from("photos_reconstituees").insert({ user_id: A.id, mois: "2024-03-01", date: "2024-03-31", total: 1, p1: 1, p2: 0, financier: 1, net: 1, qualite: "estime", part_estimee: 1, methode: "x" });
      assert.ok(ins.error, "photos_reconstituees : l'insertion par un utilisateur doit échouer");
      const upd = await A.client.from("photos_reconstituees").update({ total: 1 }).eq("user_id", A.id).select();
      assert.ok(upd.error || upd.data.length === 0, "photos_reconstituees : la mise à jour par un utilisateur doit échouer");
      const del = await A.client.from("photos_reconstituees").delete().eq("user_id", A.id).select();
      assert.ok(del.error || del.data.length === 0, "photos_reconstituees : la suppression par un utilisateur doit échouer");
      const { data } = await admin.from("photos_reconstituees").select("total").eq("user_id", A.id);
      assert.equal(Number(data[0].total), 1000, "la photo de A est intacte");
    });
  });

  describe("appliquer_propositions() / retirer_import() sur la cible historique", () => {
    it("A valide un import de relevés en aal2 (tout ou rien), B ne peut ni le voir ni le retirer ; A en aal1 ne peut pas le retirer", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const ref = randomUUID();
      const apres = {
        type: "releves", empreinte: empreinte(), fichier: { format: "csv" }, etablissement: "lcl", periode: { du: "2024-05-01", au: "2024-05-31" },
        compte: { libelle: "Compte validé", type: "courant", titulaire: "p1", cle: `valide-${sansChiffres(ref)}` },
        donnees: { mois: [{ mois: "2024-05", complet: true, controle: { total_entrees: 100, total_sorties: 40 },
          categories: [{ categorie: "revenus", sous_categorie: "", entrees: 100, sorties: 0, nombre: 1 }, { categorie: "divers", sous_categorie: "", entrees: 0, sorties: 40, nombre: 2 }] }] },
        resume: {}, avertissements: [],
      };
      const dep = await A.client.from("propositions").insert({ cible: "historique", operation: "creer", ref, apres, source: "Export déposé dans la conversation" }).select("id").single();
      assert.equal(dep.error, null, `la proposition se dépose (${dep.error?.message})`);
      const ap = await A.client.rpc("appliquer_propositions", { p_ids: [dep.data.id], p_modifications: {} });
      assert.equal(ap.error, null, `appliquer_propositions en aal2 (${ap.error?.message})`);
      assert.equal(ap.data, 1);
      const vu = await A.client.from("historique_banque_mois").select("categorie").eq("mois", "2024-05-01");
      assert.equal(vu.data.length, 2, "les deux catégories du mois sont écrites");
      const vuB = await B.client.from("historique_imports").select("id").eq("id", ref);
      assert.deepEqual(vuB.data, [], "B ne voit pas l'import de A");
      const retB = await B.client.rpc("retirer_import", { p_id: ref });
      assert.ok(retB.error && /introuvable/.test(retB.error.message), `B ne retire pas l'import de A (${retB.error?.message})`);
      const c1 = await A.nouvelleSessionAal1();
      const ret1 = await c1.rpc("retirer_import", { p_id: ref });
      assert.ok(ret1.error && /Double authentification requise/.test(ret1.error.message), `A en aal1 ne retire pas (${ret1.error?.message})`);
      const ret = await A.client.rpc("retirer_import", { p_id: ref });
      assert.equal(ret.error, null, `A retire en aal2 (${ret.error?.message})`);
      const apres2 = await A.client.from("historique_banque_mois").select("categorie").eq("mois", "2024-05-01");
      assert.deepEqual(apres2.data, [], "les catégories du mois partent avec l'import");
      await A.client.from("propositions").delete().eq("id", dep.data.id); // export_all : pas de proposition en trop
    });
  });

  describe("export_all() et delete_me()", () => {
    it("l'export de A contient ses cinq tables et rien de B ; delete_me (aal2) emporte tout et laisse B intact", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const { data, error } = await A.client.rpc("export_all");
      assert.equal(error, null, `export_all : l'appel par A en aal2 doit réussir (${error?.message})`);
      for (const t of T) {
        assert.ok(Array.isArray(data[t.name]), `export_all : ${t.name} doit être un tableau`);
        assert.ok(data[t.name].length >= 1 && data[t.name].every((r) => r.user_id === A.id), `export_all : ${t.name} ne contient que des lignes de A`);
      }
      const json = JSON.stringify(data);
      assert.ok(!json.includes(B.id) && !json.includes(B.compteId) && !json.includes(B.importId), "export_all : rien de B dans l'export de A");
      const c1 = await A.nouvelleSessionAal1();
      const del1 = await c1.rpc("delete_me");
      assert.ok(del1.error, "delete_me : refusé en aal1 pour un compte à double authentification");
      const del = await A.client.rpc("delete_me");
      assert.equal(del.error, null, `delete_me : l'appel par A en aal2 doit réussir (${del.error?.message})`);
      for (const t of T) {
        const { data: rows, error: e } = await admin.from(t.name).select("user_id").eq("user_id", A.id);
        assert.equal(e, null);
        assert.equal(rows.length, 0, `${t.name} : aucune ligne de A après delete_me (cascade)`);
      }
      const { data: restant } = await admin.from("historique_comptes").select("id").eq("user_id", B.id);
      assert.equal(restant.length, 1, "les données de B sont intactes");
      A.id = null; // déjà supprimé : le nettoyage ne doit pas réessayer
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// BUD1 (migration 0035) : deux nouvelles tables. banque_marchands_mois (totaux par marchand, écrits par le service) suit le régime des tables
// banque_* (0028, 0033) : fermée à toute session aal1, lue par son propriétaire en aal2, jamais écrite par un utilisateur. budget_regles (règles
// personnelles de classement) suit « aal2 si facteur » : les comptes ci-dessous ont un facteur TOTP vérifié, donc la table est fermée en aal1.
// ---------------------------------------------------------------------------------------------------------------------------------
describe("isolation RLS : tables du budget (comptes à double authentification)", () => {
  let admin, A, B;

  /** Sème, par le service, un compte courant et un total par marchand ; par le client aal2 du compte, une règle de classement. */
  async function seed(u) {
    const steps = [
      ["banque_connexions", { id: 1, user_id: u.id, etablissement: `Banque ${u.label}` }],
      ["banque_comptes", { id: 10, user_id: u.id, connexion_id: 1, nom: `Courant ${u.label}`, type: "courant" }],
      ["banque_marchands_mois", { user_id: u.id, mois: "2024-01-01", compte_id: 10, cle_marchand: `marche ${u.label.toLowerCase()}`, sous_categorie: "courses", entrees: 0, sorties: 40, nombre: 2 }],
    ];
    for (const [table, row] of steps) {
      const { error } = await admin.from(table).insert(row);
      assert.equal(error, null, `${table} : le service sème la ligne de ${u.label} (${error?.message})`);
    }
    const r = await u.client.from("budget_regles").insert({ motif: `regle ${u.label.toLowerCase()}`, sous_categorie: "loisirs", source: "essai d'isolation" });
    assert.equal(r.error, null, `budget_regles : ${u.label} écrit ses propres règles en aal2 (${r.error?.message})`);
  }

  const T = [
    { name: "banque_marchands_mois", match: u => ({ compte_id: 10, mois: "2024-01-01" }), field: "sorties", patch: { sorties: 999 },
      foreign: b => ({ user_id: b.id, mois: "2024-02-01", compte_id: 10, cle_marchand: "intrus", sous_categorie: "courses", sorties: 1 }) },
    { name: "budget_regles", match: u => ({ user_id: u.id }), field: "motif", patch: { motif: "piraté" },
      foreign: b => ({ user_id: b.id, motif: "intrus", sous_categorie: "loisirs" }) },
  ];

  before(async () => {
    if (SKIP) return;
    admin = adminClient();
    A = { label: "A", ...(await createTestUserAal2("bud-a")) };
    B = { label: "B", ...(await createTestUserAal2("bud-b")) };
    await seed(A);
    await seed(B);
  });

  after(async () => {
    if (SKIP) return;
    const errors = [];
    for (const u of [B, A]) {
      if (!u?.id) continue;
      try { await deleteTestUser(u.id); } catch (e) { errors.push(e.message); }
    }
    assert.deepEqual(errors, [], `nettoyage incomplet : ${errors.join(" ; ")}`);
  });

  for (const t of T) {
    describe(t.name, () => {
      it("A (aal2) ne lit que ses propres lignes", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const { data, error } = await A.client.from(t.name).select("*");
        assert.equal(error, null, `${t.name} : la lecture de A ne doit pas échouer (${error?.message})`);
        assert.equal(data.length, 1, `${t.name} : A doit voir exactement une ligne (la sienne)`);
        assert.ok(data.every((r) => r.user_id === A.id), `${t.name} : toutes les lignes lues par A doivent porter user_id = A`);
      });

      it("A en aal1 (mot de passe seul, facteur vérifié) ne voit rien", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const c = await A.nouvelleSessionAal1();
        const { data, error } = await c.from(t.name).select("*");
        assert.equal(error, null, `${t.name} : la lecture en aal1 renvoie une liste vide, pas une erreur (${error?.message})`);
        assert.deepEqual(data, [], `${t.name} : A en aal1 ne doit voir aucune ligne`);
        const { data: adm } = await admin.from(t.name).select("user_id").eq("user_id", A.id);
        assert.equal(adm.length, 1, `${t.name} : la ligne de A existe bien (le service la voit)`);
      });

      it("A ne peut pas modifier ni supprimer la ligne de B", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const upd = await withMatch(A.client.from(t.name).update(t.patch), { ...t.match(B), user_id: B.id }).select();
        if (upd.error) assert.ok(isRlsError(upd.error), `${t.name} : erreur de droits attendue (${upd.error.message})`);
        else assert.equal(upd.data.length, 0, `${t.name} : la mise à jour de A sur la ligne de B ne doit toucher aucune ligne`);
        const del = await withMatch(A.client.from(t.name).delete(), { ...t.match(B), user_id: B.id }).select();
        if (del.error) assert.ok(isRlsError(del.error), `${t.name} : erreur de droits attendue (${del.error.message})`);
        else assert.equal(del.data.length, 0, `${t.name} : la suppression de A sur la ligne de B ne doit toucher aucune ligne`);
        const { data } = await withMatch(admin.from(t.name).select("*"), { ...t.match(B), user_id: B.id }).single();
        assert.ok(data, `${t.name} : la ligne de B existe encore`);
        assert.notDeepEqual(data[t.field], t.patch[t.field], `${t.name} : ${t.field} de B n'a pas reçu la valeur de A`);
      });

      it("A ne peut pas insérer une ligne au nom de B", async (tc) => {
        if (skipIfNoKey(tc)) return;
        const { error } = await A.client.from(t.name).insert(t.foreign(B)).select();
        assert.ok(error, `${t.name} : l'insertion avec user_id = B par A doit échouer`);
        assert.match(error.message, /row-level security|violates|permission/i, `${t.name} : l'erreur doit être un refus de droits`);
      });
    });
  }

  describe("banque_marchands_mois : écrite par le service seulement", () => {
    it("A (aal2) ne peut ni insérer, ni modifier, ni supprimer ses propres totaux", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const ins = await A.client.from("banque_marchands_mois").insert({ user_id: A.id, mois: "2024-03-01", compte_id: 10, cle_marchand: "x", sous_categorie: "courses", sorties: 1 });
      assert.ok(ins.error, "l'insertion par un utilisateur doit échouer");
      const upd = await A.client.from("banque_marchands_mois").update({ sorties: 1 }).eq("user_id", A.id).select();
      assert.ok(upd.error || upd.data.length === 0, "la mise à jour par un utilisateur doit échouer");
      const del = await A.client.from("banque_marchands_mois").delete().eq("user_id", A.id).select();
      assert.ok(del.error || del.data.length === 0, "la suppression par un utilisateur doit échouer");
      const { data } = await admin.from("banque_marchands_mois").select("sorties").eq("user_id", A.id);
      assert.equal(Number(data[0].sorties), 40, "le total de A est intact");
    });
  });

  describe("budget_regles : contraintes et droits de colonne par l'API", () => {
    it("une règle vers « à classer » ou vers un relevé de carte est refusée ; la bascule active passe, pas le changement de propriétaire", async (tc) => {
      if (skipIfNoKey(tc)) return;
      for (const sc of ["a_classer", "releve_carte", "virement_interne", "inconnue"]) {
        const { error } = await A.client.from("budget_regles").insert({ motif: "xyz sarl", sous_categorie: sc });
        assert.ok(error, `une règle vers ${sc} doit être refusée`);
      }
      const off = await A.client.from("budget_regles").update({ active: false }).eq("user_id", A.id).select();
      assert.equal(off.error, null, `la bascule active passe (${off.error?.message})`);
      assert.equal(off.data[0].active, false);
      const own = await A.client.from("budget_regles").update({ user_id: B.id }).eq("user_id", A.id).select();
      assert.ok(own.error, "user_id n'est pas modifiable (droit de colonne)");
      await A.client.from("budget_regles").update({ active: true }).eq("user_id", A.id);
    });

    it("300 règles au plus par utilisateur : la 301e est refusée (le masque de PostgREST sur 54000 est accepté, la ligne n'est pas écrite)", async (tc) => {
      if (skipIfNoKey(tc)) return;
      const lot = Array.from({ length: 299 }, (_, i) => ({ motif: `motif ${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`, sous_categorie: "loisirs" }));
      const ins = await A.client.from("budget_regles").insert(lot);
      assert.equal(ins.error, null, `299 règles de plus (300 avec la première) : ${ins.error?.message}`);
      const de = await A.client.from("budget_regles").insert({ motif: "trois cent unième", sous_categorie: "loisirs" });
      assert.ok(de.error && (/300 règles/.test(de.error.message) || erreurMasquee(de.error)), `la 301e est refusée (${de.error?.message})`);
      const { data } = await admin.from("budget_regles").select("id").eq("user_id", A.id);
      assert.equal(data.length, 300, "300 règles, pas une de plus");
      await A.client.from("budget_regles").delete().like("motif", "motif %");
    });
  });
});
