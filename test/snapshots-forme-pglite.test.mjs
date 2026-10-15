// Forme réelle de snapshots.by_bloc : la fonction nocturne take_snapshots (migration 0003) l'écrit PAR PERSONNE ({ p1: { poche: valeur }, p2: { … } }),
// alors que by_envelope reste à plat. Ce test la fait tourner sur un vrai PostgreSQL (PGlite, toutes les migrations) puis vérifie que les lecteurs de
// l'app et du connecteur (Calc.blocsPhoto, argent qui dort, rétro-contrôle, rendement) lisent cette forme de production, sans photo fabriquée à la main.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { baseComplete } from "./helpers/pglite.mjs";
const req = createRequire(import.meta.url);
const Calc = req("../web/src/calc.js");
const Dn = req("../web/src/projection-donnees.js");
const R = req("../web/src/rendement.js");

const U = "11111111-1111-1111-1111-111111111111";
let lignes;
// Même vue que store-supabase.js (snapView) : la ligne SQL devient { date, foyer, p1, p2, byBloc, byEnvelope }.
const vue = r => ({ date: r.date, foyer: +r.total, p1: +r.p1, p2: +r.p2, byBloc: r.by_bloc || {}, byEnvelope: r.by_envelope || {}, source: r.source });

before(async () => {
  const db = await baseComplete();
  await db.exec(`insert into auth.users (id) values ('${U}');
    insert into public.positions (user_id, name, envelope, owner, bloc, mode, value, status) values
      ('${U}', 'ETF monde', 'PEA', 'p1', 'Monde', 'manual', 4000, 'actif'),
      ('${U}', 'ETF monde Sam', 'PEA Sam', 'p2', 'Monde', 'manual', 1000, 'actif'),
      ('${U}', 'Livret A', 'Livret A', 'p1', 'Épargne', 'manual', 2000, 'actif'),
      ('${U}', 'Livret B', 'Livret B', 'p2', 'Épargne', 'manual', 3000, 'actif'),
      ('${U}', 'Compte joint', 'Compte joint', 'p2', 'Comptes courants', 'manual', 6000, 'actif'),
      ('${U}', 'Prime', 'À recevoir', 'p1', 'Épargne', 'manual', 9999, 'à recevoir');`);
  for (const d of ["2026-07-31", "2026-08-31", "2026-09-30"]) await db.query("select public.take_snapshots($1::date, $2::uuid)", [d, U]);
  // PGlite rend les dates en Date, Supabase en « AAAA-MM-JJ » : on rend la ligne telle que la renvoie l'API.
  lignes = (await db.query("select * from public.snapshots where user_id = $1 order by date", [U])).rows.map(r => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
});

test("take_snapshots écrit by_bloc par personne et by_envelope à plat (la forme que lisent les readers)", () => {
  const s = lignes[0];
  assert.deepEqual(Object.keys(s.by_bloc).sort(), ["p1", "p2"]);
  assert.deepEqual(s.by_bloc.p1, { Monde: 4000, "Épargne": 2000 });
  assert.deepEqual(s.by_bloc.p2, { Monde: 1000, "Épargne": 3000, "Comptes courants": 6000 });
  assert.equal(s.by_envelope["Livret A"], 2000);
});

test("Calc.blocsPhoto lit la photo de production : foyer = p1 + p2 = total, une personne = ses poches", () => {
  const p = vue(lignes[0]);
  assert.deepEqual(Calc.blocsPhoto(p, "foyer"), { Monde: 5000, "Épargne": 5000, "Comptes courants": 6000 });
  assert.deepEqual(Calc.blocsPhoto(p, "p1"), { Monde: 4000, "Épargne": 2000 });
  assert.equal(Object.values(Calc.blocsPhoto(p, "foyer")).reduce((a, v) => a + v, 0), p.foyer);
  assert.equal(Object.values(Calc.blocsPhoto(p, "p2")).reduce((a, v) => a + v, 0), p.p2);
});

test("argent qui dort : calculé sur les photos de production (poche « Comptes courants » portée par p2 seulement)", () => {
  const budget = { lignes: [{ type: "depense", montant: 2000 }] };   // seuil 3 000 € ; le compte joint est à 6 000 € depuis deux fins de mois
  const positions = [{ id: "cj", name: "Compte joint", envelope: "Compte joint", bloc: "Comptes courants", owner: "p2", mode: "manual", value: 6000, status: "actif" }];
  const r = Calc.argentQuiDort({ positions, budget, profil: {}, config: {}, snapshots: lignes.map(vue) }, "2026-10-12");
  assert.ok(r, "la poche courante est trouvée dans by_bloc.p2");
  assert.deepEqual([r.mois, r.solde, r.montant], [3, 6000, 3000]);
});

test("rétro-contrôle : les photos de production donnent des poches (Monde, Épargne…) et non « p1 » / « p2 »", () => {
  const h = Dn.historiquePourRetro(lignes.map(vue), []);
  assert.equal(h.points.length, 3);
  h.points.forEach(p => { assert.deepEqual(Object.keys(p.byBloc).sort(), ["Comptes courants", "Monde", "Épargne"]); assert.equal(p.net, 16000); });
  // même résultat que les lignes SQL brutes (forme lue par le connecteur)
  assert.deepEqual(Dn.historiquePourRetro(lignes, []), h);
});

test("rendement : le relevé de production, comptes courants retirés, donne la valeur des placements", () => {
  const S = { scope: "foyer", positions: [], snapshots: lignes.map(vue), tx: [], classes: {} };
  const r = R.pointsEtFlux(S, "foyer", "2026-10-14");
  assert.deepEqual(r.points.slice(0, 3).map(p => p.valeur), [10000, 10000, 10000]);
});
