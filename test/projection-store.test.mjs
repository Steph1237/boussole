// PROJ : store de la démo (événements de vie, variantes, plans figés, indices des prix, réglages de projection), valeurs de démo valides pour le moteur,
// parité des messages entre la démo et le moteur (cas V-1 à V-15) et lecture seule (l'app n'écrit qu'en validant des propositions).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { FIXTURE } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");
const J = o => JSON.parse(JSON.stringify(o));
const E = req("../web/src/projection-evenements.js");

function browser(prep) {
  const mem = new Map();
  const ctx = { console, setTimeout, clearTimeout, location: { href: "http://localhost/app.html?demo", search: "?demo", hash: "", pathname: "/app.html" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src("demo-data.js"), ctx);
  prep && prep(ctx.DEMO);
  for (const f of ["calc.js", "reperes.js", "calendrier.js", "plan.js", "marche.js", "projection-outils.js", "projection-fiscalite.js", "projection-evenements.js", "projection-credit.js",
    "projection-donnees.js", "projection-immo.js", "projection.js", "sensible.js", "routine-etat.js", "banque-etat.js", "store-demo.js"]) vm.runInContext(src(f), ctx, { filename: f });
  return ctx;
}
const pret = ctx => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("store jamais prêt")), 3000);
  const check = S => { if (S.ready) { clearTimeout(t); res(S); } };
  ctx.Store.on(check); check(ctx.Store.get());
});
const prop = (id, cible, operation, apres, ref) => ({ id, lot: "l-proj", cible, operation, ref: ref || null, avant: null, apres, source: "test", justification: null, statut: "en_attente", creeLe: "2026-10-11T10:00:00.000Z", decideLe: null });
const demo = async (propositions = []) => { const ctx = browser(D => propositions.forEach(p => D.propositions.push(p))); return { ctx, S: await pret(ctx) }; };
const refuse = async (ctx, id) => { try { await ctx.Store.propositions.appliquer([id]); return null; } catch (e) { return e.message; } };

test("démo : événements de vie, variantes, indices des prix et réglages de projection au contrat", async () => {
  const { S } = await demo();
  assert.deepEqual(Object.keys(S.foyer).sort(), ["evenements", "variantes"]);
  const types = J(S.foyer.evenements.map(e => e.type).sort());
  assert.deepEqual(types, ["achat_immobilier", "changement_emploi", "conge_parental", "creche", "naissance", "naissance"]);
  for (const e of S.foyer.evenements) {
    assert.deepEqual(Object.keys(e).sort(), ["created_at", "date", "fin", "id", "libelle", "params", "personne", "source", "type", "updated_at", "variante_id"]);
    assert.equal(E.validerEvenement(e, { today: new Date().toISOString().slice(0, 10), credits: S.profil.credits, biens: S.profil.biens }), null, e.libelle);
  }
  assert.equal(S.foyer.variantes.length, 1); assert.equal(S.foyer.variantes[0].nom, "2ᵉ enfant");
  assert.equal(E.validerVariante(S.foyer.variantes[0]), null);
  assert.equal(S.foyer.evenements.filter(e => e.variante_id === S.foyer.variantes[0].id).length, 3, "naissance, congé parental et crèche appartiennent à la variante");
  assert.equal(S.indices.length, 60); assert.equal(S.indices[0].serie, "ipc_insee"); assert.deepEqual(Object.keys(S.indices[0]).sort(), ["mois", "serie", "source_titre", "source_url", "valeur", "verifie_le"]);
  assert.equal(S.config.projection.tmi_pct, 30);
  assert.ok(S.savoir.reperes.some(r => r.cle === "rendement_central_actions" && /démo/.test(r.sourceTitre)));
  const cles = new Set(S.savoir.reperes.map(r => r.cle));
  assert.ok(FIXTURE.reperes.every(r => cles.has(r.cle)), "les 68 repères de la projection sont dans la démo");
});
test("démo : deux projections figées (revues mensuelles passées), détail à la demande", async () => {
  const { ctx, S } = await demo();
  assert.equal(S.plansFiges.length, 2);
  assert.deepEqual(Object.keys(S.plansFiges[0]).sort(), ["cree_le", "horizon_mois", "id", "raison"]);
  assert.ok(S.plansFiges.every(p => p.raison === "revue_mensuelle" && p.horizon_mois === 120));
  const d = await ctx.Store.plansFiges.detail(S.plansFiges[0].id);
  assert.equal(d.serie.p50.length, 121); assert.equal(d.parametres.graine, 20261014); assert.ok(d.parametres.evenements.length >= 3);
  assert.equal(await ctx.Store.plansFiges.detail("inconnu"), null);
});
test("démo : valide pour le moteur — aucun avertissement de donnée invalide, capacité constatée différente de la prévue, événements pris en compte", async () => {
  const { ctx, S } = await demo();
  const P = ctx.Projection, data = P.depuisEtat(J(S), "2026-10-15");
  const r = P.simuler(P.preparer(data, { horizon_ans: 10, vue: "net" }), { chemins: 300 });
  assert.ok(r.avertissements.every(m => !/événement ignoré/.test(m)), r.avertissements.join(" | "));
  assert.equal(r.capacite_source, "reel");
  assert.ok(r.capacite_base.constatee > r.capacite_base.prevue + 1, "constatée " + r.capacite_base.constatee + " contre prévue " + r.capacite_base.prevue);
  assert.equal(r.capacite_base.signale, true, "l'écart déclenche le garde-fou de la démo");
  assert.ok(r.garde_fous.some(g => g.cle === "ecart_capacite"));
  assert.deepEqual(J(r.evenements_pris_en_compte), ["Enfant 1", "Nouvel emploi de Sam", "Achat locatif"]);
  const v = P.simuler(P.preparer(data, { horizon_ans: 10, vue: "net", variante: S.foyer.variantes[0].id }), { chemins: 300 });
  assert.ok(v.evenements_pris_en_compte.includes("Enfant 2") && v.evenements_pris_en_compte.includes("Congé parental de Sam"));
  assert.ok(v.jalons.some(j => j.type === "creche"));
});
test("démo : événements, variantes et plans figés s'appliquent par proposition ; l'app n'écrit rien d'autre", async () => {
  const ev = { type: "retrait", personne: "foyer", libelle: "Voyage", date: "2027-06-01", params: { montant: 3000, libelle: "Voyage" }, source: "Ce que tu as dit à Claude (exemple)" };
  const { ctx } = await demo([prop("e1", "evenement", "creer", ev), prop("v1", "variante", "creer", { nom: "Sans voyage", description: "", retire: [], hypotheses: { epargne_delta_mensuel: 100 } })]);
  assert.deepEqual(J(await ctx.Store.propositions.appliquer(["e1", "v1"])), { appliquees: 2 });
  const S = ctx.Store.get();
  assert.equal(S.foyer.evenements.length, 7); assert.equal(S.foyer.variantes.length, 2);
  const id = S.foyer.evenements.find(e => e.libelle === "Voyage").id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const { ctx: c2 } = await demo([prop("m1", "evenement", "modifier", { params: { montant: 4500, libelle: "Voyage" } }, "e0000000-0000-4000-8000-000000000002")]);
  const msg = await refuse(c2, "m1");
  assert.match(msg, /Proposition non appliquée \(événement, modifier\)/, "modifier un événement : la validation s'applique à l'événement complet");
  const nom = "Nouvel emploi de Sam";
  const { ctx: c3 } = await demo([prop("s1", "evenement", "supprimer", null, "e0000000-0000-4000-8000-000000000002"), prop("s2", "variante", "supprimer", null, "a1b2c3d4-0000-4000-8000-0000000000e1")]);
  await c3.Store.propositions.appliquer(["s1", "s2"]);
  const S3 = c3.Store.get();
  assert.ok(!S3.foyer.evenements.some(e => e.libelle === nom)); assert.equal(S3.foyer.variantes.length, 0); assert.equal(S3.foyer.evenements.filter(e => e.variante_id).length, 0, "la variante supprimée emporte ses événements");
  assert.equal(typeof ctx.Store.foyer, "undefined", "aucune méthode d'écriture directe des événements");
});
test("démo : réglages de projection par proposition (fusion champ par champ, null retire), mêmes messages que la base", async () => {
  const { ctx } = await demo([prop("p1", "config", "modifier", { projection: { base_capacite: "prevu", reequilibrage: "annuel", source: "Ce que tu as dit à Claude (exemple)" } }),
    prop("p2", "config", "modifier", { projection: { tmi_pct: null, salaire_croissance_reelle_pct: 0.4 } }), prop("p3", "config", "modifier", { projection: { tmi_pct: 31 } }),
    prop("p4", "config", "modifier", { projection: { inconnu: 1 } })]);
  await ctx.Store.propositions.appliquer(["p1", "p2"]);
  const pj = ctx.Store.get().config.projection;
  assert.equal(pj.base_capacite, "prevu"); assert.equal(pj.reequilibrage, "annuel"); assert.equal(pj.reste_capacite, "disponible", "les autres champs sont conservés"); assert.equal("tmi_pct" in pj, false); assert.equal(pj.salaire_croissance_reelle_pct, 0.4);
  assert.match(await refuse(ctx, "p3"), /^Proposition non appliquée \(réglages, modifier\) : projection : tmi_pct invalide \(0, 11, 30, 41 ou 45 attendu\)\.$/);
  assert.match(await refuse(ctx, "p4"), /projection : champ « inconnu » inconnu \(base_capacite, capacite_mensuelle/);
});
test("démo ↔ moteur : les 15 cas V-1 à V-15 donnent le message du moteur (ou s'appliquent s'ils sont valides)", async () => {
  const cas = FIXTURE.cas.filter(c => c.famille === "validation");
  assert.equal(cas.length, 15);
  const propositions = cas.map(c => {
    const ev = JSON.parse(JSON.stringify(c.options.evenement));
    if (ev.params && ev.params.credit === "credit:c-auto") ev.params.credit = "credit:5f0c1a2e-7b3d-4e8a-9c41-2d6b8f0a3e17";
    return prop("v-" + c.id, "evenement", "creer", ev);
  });
  const { ctx } = await demo(propositions);
  for (const c of cas) {
    const msg = await refuse(ctx, "v-" + c.id);
    if (c.attendu === null) assert.equal(msg, null, c.id);
    else assert.equal(msg, "Proposition non appliquée (événement, creer) : " + c.attendu.replace(/\.$/, "") + ".", c.id);
  }
});
test("démo : crédit inconnu, variante inconnue, limites 100 événements / 10 variantes / 60 plans figés", async () => {
  const base = { type: "retrait", personne: "foyer", libelle: "x", date: "2027-06-01", params: { montant: 1 }, source: "s" };
  const { ctx } = await demo([prop("a", "evenement", "creer", { ...base, variante_id: "00000000-0000-4000-8000-000000000000" }), prop("b", "evenement", "creer", { ...base, variante_id: "pas-un-id" }),
    prop("c", "evenement", "creer", { ...base, extra: 1 })]);
  assert.match(await refuse(ctx, "a"), /variante « 00000000-0000-4000-8000-000000000000 » introuvable/);
  assert.match(await refuse(ctx, "b"), /variante_id invalide/);
  assert.match(await refuse(ctx, "c"), /événement : champ « extra » inconnu/);
  const ctx2 = browser(D => {
    for (let k = D.foyer.evenements.length; k < 99; k++) D.foyer.evenements.push({ ...D.foyer.evenements[0], id: "e0000000-0000-4000-8000-9" + String(k).padStart(11, "0"), libelle: "e" + k });
    D.propositions.push(prop("l1", "evenement", "creer", { ...base, libelle: "centième" }), prop("l2", "evenement", "creer", { ...base, libelle: "cent-unième" }));
  });
  await pret(ctx2);
  assert.equal(await refuse(ctx2, "l1"), null);
  assert.match(await refuse(ctx2, "l2"), /Limite atteinte : 100 événements au plus/);
  const ctx3 = browser(D => {
    for (let k = D.foyer.variantes.length; k < 10; k++) D.foyer.variantes.push({ ...D.foyer.variantes[0], id: "a1b2c3d4-0000-4000-8000-9" + String(k).padStart(11, "0"), nom: "v" + k });
    D.propositions.push(prop("w1", "variante", "creer", { nom: "onzième" }));
  });
  await pret(ctx3);
  assert.match(await refuse(ctx3, "w1"), /Limite atteinte : 10 variantes au plus/);
  const ctx4 = browser(D => {
    D.plansFiges = Array.from({ length: 60 }, (_, k) => ({ id: "p" + k, cree_le: "2026-01-01T00:00:00Z", raison: "manuel", horizon_mois: 12, parametres: {}, serie: {} }));
    D.propositions.push(prop("x1", "plan_fige", "creer", { raison: "manuel", horizon_mois: 12, parametres: {}, serie: {} }));
  });
  await pret(ctx4);
  assert.match(await refuse(ctx4, "x1"), /Limite atteinte : 60 plans figés au plus/);
});
test("démo : plan figé par proposition (création et suppression seulement, taille bornée)", async () => {
  const ok = { raison: "manuel", horizon_mois: 60, parametres: { today: "2026-10-15" }, serie: { mois: ["2026-10-15"], p50: [1] } };
  const { ctx } = await demo([prop("f1", "plan_fige", "creer", ok), prop("f2", "plan_fige", "creer", { ...ok, raison: "autre" }), prop("f3", "plan_fige", "creer", { ...ok, horizon_mois: 0 }),
    prop("f4", "plan_fige", "creer", { ...ok, serie: { gros: "x".repeat(250100) } }), prop("f5", "plan_fige", "modifier", ok, "x"), prop("f6", "plan_fige", "creer", { ...ok, extra: 1 })]);
  assert.deepEqual(J(await ctx.Store.propositions.appliquer(["f1"])), { appliquees: 1 });
  assert.equal(ctx.Store.get().plansFiges.length, 3);
  assert.match(await refuse(ctx, "f2"), /plan figé : raison invalide/); assert.match(await refuse(ctx, "f3"), /horizon_mois invalide/);
  assert.match(await refuse(ctx, "f4"), /serie : 250 000 octets au plus/); assert.match(await refuse(ctx, "f5"), /seules la création et la suppression/);
  assert.match(await refuse(ctx, "f6"), /plan figé : champ « extra » inconnu/);
  const id = ctx.Store.get().plansFiges[2].id;
  const { ctx: c2 } = await demo([]);
  const sup = c2.Store.get().plansFiges[0].id;
  assert.ok(id);
  const { ctx: c3 } = await demo([prop("sp", "plan_fige", "supprimer", null, "inconnu")]);
  assert.match(await refuse(c3, "sp"), /plan figé « inconnu » introuvable/);
  assert.ok(sup);
});
