// Test des fonctions SQL de la nuit : take_snapshots() et apply_recurring().
//
// Nécessite la clé service dans SUPABASE_SERVICE_KEY (création d'un compte confirmé, appel des
// RPC réservées au rôle service). Sans elle, chaque test est sauté (jamais en échec).
// Les RPC sont appelées avec p_user = compte de test : aucun autre utilisateur n'est touché.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  hasServiceKey, SKIP_REASON, adminClient, createTestUser, deleteTestUser,
} from "./helpers/supabase.mjs";

const SKIP = !hasServiceKey;
const skipIfNoKey = (t) => { if (SKIP) { t.skip(SKIP_REASON); return true; } return false; };

// Date du jour à Paris (celle utilisée par défaut côté SQL).
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const day = Number(today.slice(8, 10));
const month = today.slice(0, 7);
const TEST_ISIN = `X-NIGHTLY-${Date.now()}`;
const PRICE = 50;

describe("fonction nocturne (SQL)", () => {
  let admin, user, market, manual;

  before(async () => {
    if (SKIP) return;
    admin = adminClient();
    user = await createTestUser("nightly");

    const ins = await admin.from("instruments").insert({ isin: TEST_ISIN, name: "Instrument de test", price: PRICE, price_date: today });
    assert.equal(ins.error, null, `instrument : ${ins.error?.message}`);

    const pos = await admin.from("positions").insert([
      { user_id: user.id, name: "ETF test", envelope: "PEA", owner: "p1", bloc: "Actions", mode: "market", isin: TEST_ISIN, qty: 10 },
      { user_id: user.id, name: "Livret test", envelope: "Livret A", owner: "p2", bloc: "Épargne", mode: "manual", value: 1000, value_date: today },
    ]).select("id, mode");
    assert.equal(pos.error, null, `positions : ${pos.error?.message}`);
    market = pos.data.find((p) => p.mode === "market");
    manual = pos.data.find((p) => p.mode === "manual");

    const cfg = await admin.from("config").upsert({
      user_id: user.id,
      recurring: [{ id: "r1", label: "PEA mensuel", positionId: market.id, amount: 100, day, start: "2020-01-01" }],
    });
    assert.equal(cfg.error, null, `config : ${cfg.error?.message}`);
  });

  after(async () => {
    if (SKIP) return;
    await deleteTestUser(user?.id);
    await admin.from("instruments").delete().eq("isin", TEST_ISIN);
  });

  it("take_snapshots() photographie le compte au total attendu", async (t) => {
    if (skipIfNoKey(t)) return;
    const { data: n, error } = await admin.rpc("take_snapshots", { p_date: today, p_user: user.id });
    assert.equal(error, null, error?.message);
    assert.equal(n, 1);
    const { data: snap } = await admin.from("snapshots").select("*").eq("user_id", user.id).eq("date", today).single();
    assert.equal(Number(snap.total), 10 * PRICE + 1000);
    assert.equal(Number(snap.p1), 500);
    assert.equal(Number(snap.p2), 1000);
    assert.equal(snap.source, "nightly");
    assert.equal(Number(snap.by_bloc.p1.Actions), 500);
    assert.equal(Number(snap.by_envelope["Livret A"]), 1000);
  });

  it("apply_recurring() applique le versement une seule fois", async (t) => {
    if (skipIfNoKey(t)) return;
    const first = await admin.rpc("apply_recurring", { p_date: today, p_user: user.id });
    assert.equal(first.error, null, first.error?.message);
    assert.equal(first.data, 1);
    const second = await admin.rpc("apply_recurring", { p_date: today, p_user: user.id });
    assert.equal(second.error, null, second.error?.message);
    assert.equal(second.data, 0, "le second passage du même jour ne doit rien appliquer");

    const { data: tx } = await admin.from("transactions").select("*").eq("user_id", user.id).eq("type", "programme");
    assert.equal(tx.length, 1);
    assert.equal(tx[0].source, "nightly");
    assert.equal(Number(tx[0].amount), 100);
    assert.equal(Number(tx[0].qty), 2);
    assert.equal(Number(tx[0].price), PRICE);

    const { data: pos } = await admin.from("positions").select("qty").eq("id", market.id).single();
    assert.equal(Number(pos.qty), 12);
    const { data: cfg } = await admin.from("config").select("recurring").eq("user_id", user.id).single();
    assert.equal(cfg.recurring[0].lastApplied, month);
    const { data: man } = await admin.from("positions").select("value").eq("id", manual.id).single();
    assert.equal(Number(man.value), 1000, "la ligne manuelle sans versement reste inchangée");
  });

  it("la photo suivante inclut le versement", async (t) => {
    if (skipIfNoKey(t)) return;
    const { error } = await admin.rpc("take_snapshots", { p_date: today, p_user: user.id });
    assert.equal(error, null, error?.message);
    const { data: snap } = await admin.from("snapshots").select("total").eq("user_id", user.id).eq("date", today).single();
    assert.equal(Number(snap.total), 12 * PRICE + 1000);
  });
});
