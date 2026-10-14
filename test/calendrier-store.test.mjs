// DAT1 : store de la démo (web/src/store-demo.js) et store Supabase (web/src/store-supabase.js) pour le calendrier patrimonial.
// - la démo valide les quatre nouvelles clés de la cible config et la naissance comme appliquer_propositions de 0029 : mêmes cas, mêmes messages
//   (comparés à une vraie base PGlite sur 15 cas refusés) ; tout ou rien ;
// - la démo est valide pour le moteur (aucune règle indisponible, échéances variées, données à compléter) ;
// - store-supabase lit les colonnes de 0029 et date_fin des repères.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { baseComplete, comme } from "./helpers/pglite.mjs";

const require = createRequire(import.meta.url);
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const Cal = require("../web/src/calendrier.js");
const A = "11111111-1111-1111-1111-111111111111";
const CREDIT = "aaaaaaaa-0000-4000-8000-000000000001", BIEN = "aaaaaaaa-0000-4000-8000-000000000002", INCONNU = "cccccccc-0000-4000-8000-000000000009";
// Jour de Paris (AAAA-MM-JJ) : la CI tourne en UTC et échouait entre minuit et 2 h à Paris (naissance « future » ou année fausse).
const jourParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ANNEE = +jourParis().slice(0, 4), FUTUR = (ANNEE + 1) + "-01-01";

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
const prop = (id, cible, apres) => ({ id, lot: "l-cal", cible, operation: "modifier", ref: null, avant: null, apres, source: "test", justification: null, statut: "en_attente",
  creeLe: "2026-10-11T10:00:00.000Z", decideLe: null });
/** Démo avec un crédit et un bien aux identifiants UUID (comme en base) et les propositions fournies. */
const demo = async (propositions = []) => {
  const ctx = browser(D => {
    D.profil.credits.push({ id: CREDIT, nom: "Crédit Exemple", owner: "p1", crd: 90000, mensualite: 700 });
    D.profil.biens.push({ id: BIEN, nom: "Appartement Exemple", usage: "rp", valeur: 250000, part_p1: 100, crd: 120000, mensualite: 900, loyer: 0 });
    propositions.forEach(p => D.propositions.push(p));
  });
  return { ctx, S: await pret(ctx) };
};
const SRC = "Relevé annuel 2025 (exemple)";
const env = (o = {}) => ({ type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", source: SRC, ...o });

/* ---------------------------------------------------------------- démo : valeurs acceptées */
test("démo : les quatre clés du calendrier s'appliquent (fusion par clé, remplacement, avis effaçable) et la naissance du profil", async () => {
  const { ctx } = await demo([
    prop("c1", "config", { enveloppes_infos: { "PEA Exemple": env({ versements_cumules: 92000, le: "2026-02-12" }), "PEE Exemple": { type: "pee", titulaire: "p2", versements: [{ le: "2023-04-20", montant: 800, origine: "abondement" }], source: SRC } } }),
    prop("c2", "config", { prets_infos: { ["credit:" + CREDIT]: { date_signature: "2022-04-15", duree_mois: 84, taux_pct: 3.5, source: "Offre de prêt (exemple)" } } }),
    prop("c3", "config", { donations: [{ id: "d1", date: "2015-07-01", montant: 20000, donateur: "p1", lien: "enfant", beneficiaire: "Enfant 1", nature: "donation", source: "Acte (exemple)" }] }),
    prop("c4", "config", { avis_impot: { annee_revenus: ANNEE - 1, rfr: 31000, plafonds_per: { p1: [{ annee: ANNEE - 1, montant: 1234 }] }, source: "Avis d'impôt (exemple)" } }),
    prop("c5", "profil", { personnes: { p1: { naissance: "1980-06" } } }),
  ]);
  const avant = J(ctx.Store.get().config.enveloppes_infos);
  assert.deepEqual(J(await ctx.Store.propositions.appliquer(["c1", "c2", "c3", "c4", "c5"])), { appliquees: 5 });
  const S = ctx.Store.get();
  assert.deepEqual(Object.keys(S.config.enveloppes_infos).sort(), [...Object.keys(avant), "PEA Exemple", "PEE Exemple"].sort(), "fusion par clé : les autres enveloppes restent");
  assert.equal(S.config.enveloppes_infos["PEA Exemple"].le, "2026-02-12");
  assert.match(S.config.enveloppes_infos["PEE Exemple"].le, /^\d{4}-\d{2}-\d{2}$/, "le par défaut : la date du jour");
  assert.deepEqual(J(S.config.prets_infos["credit:" + CREDIT]), { date_signature: "2022-04-15", duree_mois: 84, taux_pct: 3.5, source: "Offre de prêt (exemple)", le: S.config.prets_infos["credit:" + CREDIT].le });
  assert.equal(S.config.donations.length, 1, "la liste remplace la liste");
  assert.equal(S.config.avis_impot.annee_revenus, ANNEE - 1);
  assert.equal(S.profil.personnes.p1.naissance, "1980-06");
  assert.equal(S.profil.personnes.p1.nom, "Camille", "le reste de la personne est conservé");
  // null retire une enveloppe ; { } efface l'avis
  const { ctx: c2 } = await demo([prop("n1", "config", { enveloppes_infos: { "PEA Camille": null } }), prop("n2", "config", { avis_impot: {} })]);
  await c2.Store.propositions.appliquer(["n1", "n2"]);
  assert.equal("PEA Camille" in c2.Store.get().config.enveloppes_infos, false);
  assert.deepEqual(J(c2.Store.get().config.avis_impot), {});
});
test("démo : une proposition invalide n'applique rien (tout ou rien) et reste en attente", async () => {
  const { ctx, S } = await demo([prop("t1", "config", { donations: [] }), prop("t2", "config", { enveloppes_infos: { "PEA X": env({ type: "plan_inconnu" }) } })]);
  const avant = J(S.config);
  await assert.rejects(ctx.Store.propositions.appliquer(["t1", "t2"]), e => /^Proposition non appliquée \(réglages, modifier\) : enveloppes_infos « PEA X » : type invalide/.test(e.message));
  assert.deepEqual(J(ctx.Store.get().config), avant);
  assert.ok(ctx.Store.get().propositions.filter(p => ["t1", "t2"].includes(p.id)).every(p => p.statut === "en_attente"));
});

/* ---------------------------------------------------------------- parité des messages avec la base */
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
before(async () => {
  db = await baseComplete();
  await db.exec(`insert into auth.users (id) values ('${A}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    insert into public.credits (id, user_id, nom, crd, mensualite) values ('${CREDIT}', '${A}', 'Crédit Exemple', 90000, 700);
    insert into public.biens (id, user_id, nom, valeur, crd) values ('${BIEN}', '${A}', 'Appartement Exemple', 250000, 120000);`);
  await comme(db, A);
});
after(async () => { await db.close(); });
const messageBase = async (cible, apres) => {
  const id = (await q(`insert into public.propositions (cible, operation, apres, source) values ($1, 'modifier', $2, 'test') returning id`, [cible, JSON.stringify(apres)]))[0].id;
  try { await q("select public.appliquer_propositions($1::uuid[], '{}'::jsonb) n", [[id]]); return null; } catch (e) { return e.message; }
};
const messageDemo = async (cible, apres) => {
  const { ctx } = await demo([prop("x1", cible, apres)]);
  try { await ctx.Store.propositions.appliquer(["x1"]); return null; } catch (e) { return e.message; }
};
const norm = m => String(m).replace(/\.$/, "");
const CAS = [
  ["config", { enveloppes_infos: { "PEA Exemple": env({ date_ouverture: "2021-02-30" }) } }],
  ["config", { enveloppes_infos: { "PEA Exemple": env({ type: "plan_inconnu" }) } }],
  ["config", { enveloppes_infos: { "PEA Exemple": env({ titulaire: "p3" }) } }],
  ["config", { enveloppes_infos: { "PEA Exemple|p2": env() } }],
  ["config", { enveloppes_infos: { "PEA Exemple": env({ date_ouverture_approx: "2021" }) } }],
  ["config", { enveloppes_infos: { "PEA Exemple": env({ date_ouverture: FUTUR }) } }],
  ["config", { enveloppes_infos: { "PEA Exemple": env({ versements: [{ le: "2022-03-15", montant: 100, origine: "versement" }] }) } }],
  ["config", { enveloppes_infos: { "PEA Exemple": env({ source: "" }) } }],
  ["config", { enveloppes_infos: { "PEA Exemple": env({ versements_cumules: 1000, versements_avant_70: 2000 }) } }],
  ["config", { enveloppes_infos: { "PEA Exemple": env({ bidule: 1 }) } }],
  ["config", { prets_infos: { ["credit:" + INCONNU]: { date_fin: "2029-04-15", source: SRC } } }],
  ["config", { prets_infos: { ["credit:" + CREDIT]: { date_signature: "2022-04-15", date_fin: "2021-01-01", source: SRC } } }],
  ["config", { prets_infos: { ["bien:" + BIEN]: { duree_mois: 481, source: SRC } } }],
  ["config", { prets_infos: { "prêt-1": { duree_mois: 12, source: SRC } } }],
  ["config", { donations: [{ id: "d1", date: "2015-07-01", montant: 1, donateur: "p1", lien: "enfant", beneficiaire: "E", nature: "donation", source: SRC }, { id: "d1", date: "2015-07-01", montant: 1, donateur: "p1", lien: "enfant", beneficiaire: "E", nature: "donation", source: SRC }] }],
  ["config", { donations: [{ id: "d1", date: "2015-07-01", montant: 1, donateur: "p1", lien: "ami", beneficiaire: "E", nature: "donation", source: SRC }] }],
  ["config", { avis_impot: { annee_revenus: 1999, source: SRC } }],
  ["config", { avis_impot: { annee_revenus: ANNEE - 1, plafonds_per: { p1: [{ annee: 2024, montant: 0 }] }, source: SRC } }],
  ["config", { cushion: { mode: "amount", min: 1 }, autre: 1 }],
  ["profil", { personnes: { p1: { naissance: "1990-13" } } }],
  ["profil", { personnes: { p1: { naissance: FUTUR } } }],
];
test("démo ↔ base : mêmes refus, mêmes messages sur " + CAS.length + " cas (ni accepté d'un côté seulement, ni message différent)", async () => {
  for (const [cible, apres] of CAS) {
    const base = await messageBase(cible, apres), d = await messageDemo(cible, apres);
    assert.ok(base, "la base refuse : " + JSON.stringify(apres));
    assert.ok(d, "la démo refuse : " + JSON.stringify(apres));
    assert.equal(norm(d), norm(base), JSON.stringify(apres));
  }
});
test("démo ↔ base : mêmes acceptations (valeurs valides, listes vides non stockées, normalisation)", async () => {
  const valides = [
    ["config", { enveloppes_infos: { "PEA Exemple": env({ versements_cumules: "92000", le: "2026-02-12" }) } }],
    ["config", { enveloppes_infos: { "PEE Exemple": { type: "pee", titulaire: "p2", versements: [], source: SRC } } }],
    ["config", { prets_infos: { ["bien:" + BIEN]: { date_fin: "2041-06-30", ira_exoneration: true, source: SRC } } }],
    ["config", { donations: [] }],
    ["config", { avis_impot: {} }],
    ["profil", { personnes: { p1: { naissance: "1980-06-15" } } }],
  ];
  for (const [cible, apres] of valides) {
    assert.equal(await messageBase(cible, apres), null, "base : " + JSON.stringify(apres));
    assert.equal(await messageDemo(cible, apres), null, "démo : " + JSON.stringify(apres));
  }
});

/* ---------------------------------------------------------------- démo valide pour le moteur ; store-supabase */
test("démo : le calendrier a des échéances, des données à compléter et aucune règle indisponible", async () => {
  const { S } = await demo();
  const today = jourParis(); // Calendrier.calendrier attend le jour de Paris
  const r = Cal.calendrier({ positions: S.positions, config: S.config, profil: S.profil, credits: S.profil.credits, biens: S.profil.biens, reperes: S.savoir.reperes }, today);
  assert.deepEqual(r.regles_indisponibles, []);
  const cles = new Set(r.jalons.map(j => j.cle));
  for (const k of ["pea_5_ans", "av_8_ans", "av_abattement_annee", "pel_12_ans", "donation_15_ans", "pret_fin", "per_fin_annee", "taux_reglementes", "av_70_ans"]) assert.ok(cles.has(k), "jalon " + k);
  assert.ok(r.jalons.some(j => j.statut === "passe") && r.jalons.some(j => j.statut === "proche") && r.jalons.some(j => j.statut === "futur"), "des échéances passées, proches et futures");
  assert.ok(r.a_completer.some(a => a.enveloppe === "PEA Sam" && a.champ === "date_ouverture"), "une enveloppe sans date");
  assert.ok(r.a_completer.some(a => a.champ === "avis_impot") && r.a_completer.some(a => a.champ === "date_fin"));
  assert.equal(r.seuils.length, 2);
});
test("store-supabase.js : cfgView lit les quatre colonnes de 0029 (défauts), les repères lisent date_fin (dateFin)", () => {
  const sup = src("store-supabase.js");
  assert.match(sup, /enveloppes_infos: objetOu\(r\.enveloppes_infos\), prets_infos: objetOu\(r\.prets_infos\), donations: Array\.isArray\(r\.donations\) \? r\.donations : \[\], avis_impot: objetOu\(r\.avis_impot\)/);
  assert.ok(sup.includes('select("cle, libelle, valeur, unite, date_effet, date_fin, source_titre, source_url, verifie_le, mode")'));
  assert.match(sup, /dateFin: x\.date_fin \|\| null/);
  const mem = new Map();
  const ctx = { console, window: {}, localStorage: { getItem: k => mem.get(k) ?? null, setItem() {}, removeItem() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(src("reperes.js"), ctx);
  assert.equal(J(ctx.Reperes.depuisLignes([{ cle: "x", valeur: "1", unite: "%", date_effet: "2026-01-01", date_fin: "2027-01-31" }])[0]).dateFin, "2027-01-31");
});
