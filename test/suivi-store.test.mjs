// SUIVI : store de la démo (web/src/store-demo.js) et store Supabase (web/src/store-supabase.js) pour les rôles, la politique de suivi et les frais d'enveloppe.
// - la démo valide config.suivi, arbitrage_pct / courtage_pct et les champs role / role_source de la cible position comme appliquer_propositions de 0032 :
//   mêmes cas, mêmes messages (comparés à une vraie base PGlite) ;
// - les rôles de la démo sont mixtes (dont des rôles à confirmer), la démo donne un déclencheur qui vaut le coût et un qui ne le vaut pas ;
// - store-supabase lit role, role_source, config.suivi et routines.etat_suivi.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { baseComplete, comme } from "./helpers/pglite.mjs";

const require = createRequire(import.meta.url);
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const Suivi = require("../web/src/suivi.js");
const A = "11111111-1111-1111-1111-111111111111";
const jourParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function browser(prep) {
  const mem = new Map();
  const ctx = { console, setTimeout, clearTimeout, location: { href: "http://localhost/app.html?demo", search: "?demo", hash: "", pathname: "/app.html" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src("demo-data.js"), ctx);
  prep && prep(ctx.DEMO);
  for (const f of ["marche.js", "projection-outils.js", "projection-evenements.js", "sensible.js", "routine-etat.js", "banque-etat.js", "store-demo.js"]) vm.runInContext(src(f), ctx, { filename: f });
  return ctx;
}
const pret = ctx => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("store jamais prêt")), 2000);
  const check = S => { if (S.ready) { clearTimeout(t); res(S); } };
  ctx.Store.on(check); check(ctx.Store.get());
});
const prop = (id, cible, apres, operation = "modifier", ref = null) => ({ id, lot: "l-suivi", cible, operation, ref, avant: null, apres, source: "test", justification: null, statut: "en_attente",
  creeLe: "2026-10-11T10:00:00.000Z", decideLe: null });
const demo = async (propositions = []) => { const ctx = browser(D => propositions.forEach(p => D.propositions.push(p))); return { ctx, S: await pret(ctx) }; };
const SRC = "Ce que tu as dit à Claude (exemple)";

let db;
const q = async (s, p) => (await db.query(s, p)).rows;
before(async () => {
  db = await baseComplete();
  await db.exec(`insert into auth.users (id) values ('${A}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;`);
  await comme(db, A);
});
after(async () => { await db.close(); });
const messageBase = async (cible, apres, operation = "modifier") => {
  const id = (await q(`insert into public.propositions (cible, operation, apres, source) values ($1, $3, $2, 'test') returning id`, [cible, JSON.stringify(apres), operation]))[0].id;
  try { await q("select public.appliquer_propositions($1::uuid[], '{}'::jsonb) n", [[id]]); return null; } catch (e) { return e.message; }
};
const messageDemo = async (cible, apres, operation = "modifier") => {
  const { ctx } = await demo([prop("x1", cible, apres, operation)]);
  try { await ctx.Store.propositions.appliquer(["x1"]); return null; } catch (e) { return e.message; }
};
const norm = m => String(m).replace(/\.$/, "").replace(/^Proposition non appliquée \([^)]*\) : /, "");
const FRAIS = o => ({ frais_enveloppes: { "AV Exemple": { gestion_uc_pct: 0.6, source: SRC, ...o } } });
const REFUS = [
  ["config", { suivi: { plafond_satellite_pct: 31, source: SRC } }], ["config", { suivi: { plafond_satellite_pct: -1, source: SRC } }], ["config", { suivi: { seuil_ecart_pts: 2, source: SRC } }],
  ["config", { suivi: { seuil_ecart_pts: 11, source: SRC } }], ["config", { suivi: { seuil_baisse_satellite_pct: 9, source: SRC } }], ["config", { suivi: { seuil_baisse_satellite_pct: 51, source: SRC } }],
  ["config", { suivi: { mois_revue_coeur: 13, source: SRC } }], ["config", { suivi: { mois_revue_coeur: 2.5, source: SRC } }], ["config", { suivi: { revue_coeur: "mensuelle", source: SRC } }],
  ["config", { suivi: { semaine: { actif: true, jour: "demain" }, source: SRC } }], ["config", { suivi: { semaine: { jour: "lundi" }, source: SRC } }], ["config", { suivi: { semaine: { actif: true, x: 1 }, source: SRC } }],
  ["config", { suivi: { plafond_satellite_pct: 10 } }], ["config", { suivi: { source: SRC } }], ["config", { suivi: { plafond_satellite_pct: 10, source: SRC, bidule: 1 } }],
  ["config", { suivi: { plafond_satellite_pct: 10, source: SRC, le: "2999-01-01" } }], ["config", { suivi: { plafond_satellite_pct: 10, source: SRC, le: "pas une date" } }], ["config", { suivi: [] }],
  ["config", FRAIS({ arbitrage_pct: 5.5 })], ["config", FRAIS({ courtage_pct: -0.1 })], ["config", FRAIS({ bidule: 1 })], ["config", { autre: 1 }],
  ["position", { name: "Ligne", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "manual", value: 100, role: "capitaine" }, "creer"],
  ["position", { name: "Ligne", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "manual", value: 100, role: "coeur", role_source: "devine" }, "creer"],
  ["position", { name: "Ligne", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "manual", value: 100, role_source: "valide" }, "creer"],
];
test("démo ↔ base : mêmes refus, mêmes messages sur " + REFUS.length + " cas (suivi, frais d'enveloppe, rôle d'une ligne)", async () => {
  for (const [cible, apres, operation] of REFUS) {
    const base = await messageBase(cible, apres, operation), d = await messageDemo(cible, apres, operation);
    assert.ok(base, "la base refuse : " + JSON.stringify(apres));
    assert.ok(d, "la démo refuse : " + JSON.stringify(apres));
    assert.equal(norm(d), norm(base), JSON.stringify(apres));
  }
});
test("démo ↔ base : mêmes acceptations (bornes comprises, rôles, frais d'arbitrage et de courtage)", async () => {
  const valides = [
    ["config", { suivi: { plafond_satellite_pct: 0, source: SRC } }], ["config", { suivi: { plafond_satellite_pct: 30, seuil_ecart_pts: 3, seuil_baisse_satellite_pct: 50, mois_revue_coeur: 12, source: SRC } }],
    ["config", { suivi: { revue_coeur: "semestrielle", semaine: { actif: false }, source: SRC } }], ["config", FRAIS({ arbitrage_pct: 0, courtage_pct: 5 })],
    ["position", { name: "Ligne", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "manual", value: 100, role: "satellite", role_source: "valide" }, "creer"],
  ];
  for (const [cible, apres, operation] of valides) {
    assert.equal(await messageBase(cible, apres, operation), null, "base : " + JSON.stringify(apres));
    assert.equal(await messageDemo(cible, apres, operation), null, "démo : " + JSON.stringify(apres));
  }
});
test("démo : la politique se fusionne champ par champ (null retire), une semaine remplace l'entrée, la date du jour est posée", async () => {
  const { ctx } = await demo([prop("s1", "config", { suivi: { plafond_satellite_pct: 12, semaine: { actif: true, jour: "mardi" }, source: SRC } }), prop("s2", "config", { suivi: { seuil_ecart_pts: 7, plafond_satellite_pct: null, source: "Autre source" } })]);
  const avant = ctx.Store.get().config.suivi;
  assert.equal(avant.plafond_satellite_pct, 15, "la démo fixe un plafond satellite de 15 %");
  await ctx.Store.propositions.appliquer(["s1"]);
  let s = ctx.Store.get().config.suivi;
  assert.deepEqual(J({ p: s.plafond_satellite_pct, w: s.semaine, src: s.source, le: s.le }), { p: 12, w: { actif: true, jour: "mardi" }, src: SRC, le: jourParis() });
  await ctx.Store.propositions.appliquer(["s2"]);
  s = ctx.Store.get().config.suivi;
  assert.equal(s.seuil_ecart_pts, 7); assert.equal("plafond_satellite_pct" in s, false); assert.equal(s.source, "Autre source");
});
test("démo : un rôle s'applique à une ligne (role et roleSource), retirer le rôle retire sa source", async () => {
  const { ctx } = await demo([prop("r1", "position", { role: "coeur", role_source: "valide" }, "modifier", "pea-air-liquide"), prop("r2", "position", { role: null }, "modifier", "pea-air-liquide")]);
  await ctx.Store.propositions.appliquer(["r1"]);
  let p = ctx.Store.get().positions.find(x => x.id === "pea-air-liquide");
  assert.deepEqual(J([p.role, p.roleSource]), ["coeur", "valide"]);
  await ctx.Store.propositions.appliquer(["r2"]);
  p = ctx.Store.get().positions.find(x => x.id === "pea-air-liquide");
  assert.deepEqual(J([p.role, p.roleSource]), [null, null]);
});

/* ---------------------------------------------------------------- démo valide pour le moteur de suivi */
test("démo : rôles mixtes (dont des rôles à confirmer), satellite sous un plafond de 15 %, un déclencheur de frais qui vaut le coût et un qui ne le vaut pas", async () => {
  const { S } = await demo();
  const data = Suivi.depuisEtat(S, { today: jourParis() });
  const v = Suivi.vue(data, jourParis());
  const roles = new Set(v.lignes.map(l => l.role));
  assert.ok(roles.has("reserve") && roles.has("coeur") && roles.has("satellite"), "les trois rôles");
  assert.ok(v.lignes.some(l => l.role_source === "valide") && v.lignes.some(l => l.a_confirmer), "des rôles validés et des rôles à confirmer");
  assert.ok(v.lignes.filter(l => l.a_confirmer).length >= 2, "au moins deux rôles à confirmer");
  assert.equal(v.politique.plafond_satellite_pct, 15);
  assert.ok(v.systeme.part_satellite_investi_pct > 5 && v.systeme.part_satellite_investi_pct < 15 && v.systeme.depasse === false, "satellite à " + v.systeme.part_satellite_investi_pct + " %");
  const frais = v.declencheurs.filter(d => d.cle === "frais_eleves");
  assert.ok(frais.some(d => d.enveloppe === "Assurance vie Sam" && d.verdict === "vaut_le_cout"), "assurance-vie : ça vaut le coût");
  assert.ok(frais.some(d => d.enveloppe === "CTO Sam" && d.verdict === "ne_rien_faire"), "compte-titres : ne rien faire");
  for (const d of v.declencheurs) for (const l of S.positions) if (l.name.length > 4) assert.ok(!d.titre.includes(l.name), d.titre);
});

/* ---------------------------------------------------------------- store-supabase */
test("store-supabase.js : lit role et role_source des positions, config.suivi et routines.etat_suivi", () => {
  const sup = src("store-supabase.js");
  assert.match(sup, /role: r\.role \|\| null, roleSource: r\.role_source \|\| null/);
  assert.match(sup, /suivi: objetOu\(r\.suivi\)/);
  assert.match(sup, /etatSuivi: r\.etat_suivi && typeof r\.etat_suivi === "object"/);
  assert.doesNotMatch(sup, /\.update\(\{[^}]*\b(role|etat_suivi|suivi)\b/, "l'app n'écrit ni rôle, ni politique, ni mémoire de revue");
});
