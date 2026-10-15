// Graine de préproduction (SEC5, spec § 3.4/3.9) : aucune tâche pg_cron ne vise la production après les migrations + seed.sql.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { baseComplete } from "./helpers/pglite.mjs";

const REF = "oapcewpqsbbjdlcdeizi";
const dirMig = new URL("../supabase/migrations/", import.meta.url);
const SEED = readFileSync(new URL("../preprod/seed.sql", import.meta.url), "utf8");

/** Tâches cron.schedule des migrations : { fichier, nom, vise_production }. Les commentaires (--) sont ignorés. */
function tachesDesMigrations() {
  const out = [];
  for (const f of readdirSync(dirMig).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const src = readFileSync(new URL(f, dirMig), "utf8").split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    const re = /cron\.schedule\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src))) {
      const fin = src.indexOf(");", m.index);
      const corps = src.slice(m.index, fin === -1 ? undefined : fin);
      out.push({ fichier: f, nom: m[1], vise_production: corps.includes(REF) || /supabase\.co/.test(corps) });
    }
  }
  return out;
}

describe("seed.sql désarme les tâches pg_cron vers la production", () => {
  const taches = tachesDesMigrations();
  it("repère les tâches connues", () => {
    const noms = taches.map(t => t.nom);
    for (const n of ["boussole-nightly", "boussole-powens-nuit", "boussole-purge-anonymes", "boussole-purge-propositions", "boussole-banque-purge"]) assert.ok(noms.includes(n), n);
    assert.deepEqual(taches.filter(t => t.vise_production).map(t => t.nom).sort(), ["boussole-nightly", "boussole-powens-nuit"]);
  });
  for (const t of tachesDesMigrations().filter(t => t.vise_production)) {
    it(`${t.nom} (${t.fichier}) : cron.unschedule dans seed.sql`, () => {
      assert.ok(SEED.includes(`'${t.nom}'`) && /cron\.unschedule\(/.test(SEED), `${t.nom} n'est pas désarmée`);
    });
  }
  it("seed.sql ne touche pas aux purges purement SQL", () => {
    for (const n of ["boussole-purge-anonymes", "boussole-purge-propositions", "boussole-banque-purge"]) assert.ok(!SEED.includes(`'${n}'`), n);
  });
  it("seed.sql vérifie et échoue (raise exception) si une tâche vise encore la production", () => {
    assert.match(SEED, /raise exception/);
    assert.match(SEED, /supabase\.co/);
  });
  it("ne crée aucun utilisateur et n'écrit aucun secret", () => {
    assert.ok(!/insert\s+into\s+auth\./i.test(SEED));
    assert.ok(!/create_secret|insert\s+into\s+vault/i.test(SEED));
  });
});

describe("seed.sql appliquée sur la chaîne complète (PGlite, bouchons pg_cron)", () => {
  it("après migrations + seed : cron.job sans URL de production, purges conservées, lancer_nuit définie", async () => {
    const db = await baseComplete();
    const avant = (await db.query("select jobname, command from cron.job")).rows;
    assert.ok(avant.some(r => r.command.includes(REF)), "les migrations programment bien des tâches vers la production");
    await db.exec(SEED);
    const apres = (await db.query("select jobname, command from cron.job order by jobname")).rows;
    assert.deepEqual(apres.map(r => r.jobname), ["boussole-banque-purge", "boussole-purge-anonymes", "boussole-purge-propositions"]);
    assert.ok(apres.every(r => !/supabase\.co|oapcewpqsbbjdlcdeizi/.test(r.command)));
    const f = await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'preprod' and p.proname = 'lancer_nuit'");
    assert.equal(f.rows[0].n, 1);
    await db.close();
  });

  it("idempotente : une seconde exécution passe", async () => {
    const db = await baseComplete();
    await db.exec(SEED); await db.exec(SEED);
    await db.close();
  });

  it("échoue si une tâche vise encore la production", async () => {
    const db = await baseComplete();
    await db.exec(`select cron.schedule('boussole-intruse', '0 0 * * *', $c$select net.http_post(url := 'https://${REF}.supabase.co/functions/v1/x')$c$)`);
    await assert.rejects(() => db.exec(SEED), /boussole-intruse/);
    await db.close();
  });

  it("échoue aussi pour tout autre hôte supabase.co", async () => {
    const db = await baseComplete();
    await db.exec(`select cron.schedule('autre', '0 0 * * *', $c$select net.http_post(url := 'https://abcdefgh.supabase.co/x')$c$)`);
    await assert.rejects(() => db.exec(SEED), /autre/);
    await db.close();
  });
});
