// PROJ : fiscalité de sortie (web/src/projection-fiscalite.js) — cas F-1 à F-13 de test/fixtures/projection-cas.json, chaque ligne du
// tableau du § 5.2, bornes des seuils du calendrier (veille et lendemain), abattement de l'assurance-vie, repère manquant sans valeur de secours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FIXTURE, reperesComplets } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const F = req("../web/src/projection-fiscalite.js");
const Cal = req("../web/src/calendrier.js");
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b);

function sortieDuCas(c) {
  const o = c.options, retirer = (o.ctx && o.ctx.reperes_retirer) || [];
  const reperes = reperesComplets().filter(r => !retirer.includes(r.cle));
  return F.fiscaliteSortie(o.compartiment, o.date, { ...o.ctx, reperes });
}
for (const c of FIXTURE.cas.filter(x => x.famille === "fiscalite")) {
  test(c.id + " : " + c.nom, () => {
    const s = sortieDuCas(c), a = c.attendu, tol = c.tolerance || 0.005;
    if (a.impot_revenu != null) proche(s.impot_revenu, a.impot_revenu, tol, "impôt sur le revenu");
    if (a.prelevements_sociaux != null) proche(s.prelevements_sociaux, a.prelevements_sociaux, tol, "prélèvements sociaux");
    if (a.total != null) proche(s.total, a.total, tol, "total");
    if (a.net === null) assert.equal(s.net, null); else if (a.net != null) proche(s.net, a.net, tol, "net");
    if (a.brut != null) assert.equal(s.brut, a.brut);
    if (a.regle) assert.equal(s.regle, a.regle);
    if (a.confiance) assert.equal(s.confiance, a.confiance);
    if (a.disponible === false) assert.equal(s.disponible, false);
    if (a.fraction_7_5 != null) assert.equal(s.fraction_7_5, a.fraction_7_5);
    if (a.avertissement_contient) assert.ok(s.avertissements.some(m => m.includes(a.avertissement_contient)), s.avertissements.join(" | "));
    assert.ok(s.sources.every(x => x.titre && x.url), "chaque repère utilisé porte sa source");
  });
}

const R = reperesComplets();
const sortie = (c, date, ctx) => F.fiscaliteSortie(c, date, { reperes: R, ...ctx });

test("PEA : la veille du 5ᵉ anniversaire (règle d'avant), le lendemain (règle d'après) — dates du calendrier", () => {
  const cal = Cal.calendrier({ positions: [{ id: "a", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", value: 1, status: "actif" }],
    config: { enveloppes_infos: { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2021-03-10" } } }, reperes: R }, "2026-01-01");
  const j = cal.jalons.find(x => x.cle === "pea_5_ans");
  const c = { type: "pea", valeur: 50000, base: 40000, classe: "actions", dates: { pea_5_ans: j.date } };
  assert.equal(sortie(c, Cal.joursEntre ? veille(j.date) : "x").regle, "pea_avant_5_ans");
  assert.equal(sortie(c, j.date).regle, "pea_apres_5_ans");
  assert.equal(sortie({ ...c, dates: undefined, date_ouverture: "2021-03-10" }, j.date).regle, "pea_apres_5_ans", "même date calculée depuis l'ouverture");
  assert.equal(sortie({ ...c, dates: undefined, date_ouverture: "2021-03-10" }, veille(j.date)).regle, "pea_avant_5_ans");
});
function veille(s) { const t = new Date(Date.parse(s + "T00:00:00Z") - 864e5); return t.toISOString().slice(0, 10); }

test("assurance-vie : veille et lendemain du 8ᵉ anniversaire", () => {
  const c = { type: "assurance_vie", valeur: 120000, base: 100000, classe: "fonds_euros", date_ouverture: "2018-06-10" };
  assert.equal(sortie(c, "2026-06-10", { couple: true }).regle, "av_avant_8_ans");
  assert.equal(sortie(c, "2026-06-11", { couple: true }).regle, "av_apres_8_ans");
});
test("assurance-vie : abattement annuel du foyer consommé une fois (restant passé en contexte), couple ou personne seule", () => {
  const c = { type: "assurance_vie", valeur: 120000, base: 100000, classe: "fonds_euros", date_ouverture: "2015-03-02" };
  const couple = sortie(c, "2026-10-14", { couple: true }), seul = sortie(c, "2026-10-14", { couple: false });
  proche(couple.impot_revenu, 810, 0.005); proche(seul.impot_revenu, (20000 - 4600) * 0.075, 0.005);
  assert.equal(couple.abattement_utilise, 9200);
  const reste = sortie(c, "2026-10-14", { couple: true, abattement_restant: 0 });
  proche(reste.impot_revenu, 20000 * 0.075, 0.005, "abattement déjà consommé cette année");
});
test("date d'ouverture inconnue : règle la plus prudente et mention (PEA, assurance-vie)", () => {
  const pea = sortie({ type: "pea", valeur: 50000, base: 40000, classe: "actions" }, "2026-10-14");
  assert.equal(pea.regle, "pea_avant_5_ans");
  assert.ok(pea.avertissements.some(m => m.includes("date d'ouverture à compléter")));
  assert.equal(pea.confiance, "probable");
});
test("prix de revient inconnu : aucun gain supposé et mention", () => {
  const s = sortie({ type: "compte_titres", valeur: 25000, base: 25000, classe: "actions", base_inconnue: true }, "2026-10-14");
  assert.equal(s.total, 0);
  assert.ok(s.avertissements.some(m => m.includes("prix de revient à compléter")));
});
test("PEL : intérêts imposés ; PEL d'avant 2018 exonéré d'impôt sur le revenu pendant 12 ans", () => {
  const nouveau = sortie({ type: "pel", valeur: 10500, base: 10000, classe: "monetaire", date_ouverture: "2020-01-01" }, "2026-10-14");
  proche(nouveau.impot_revenu, 64, 0.005); proche(nouveau.prelevements_sociaux, 86, 0.005);
  const ancien = sortie({ type: "pel", valeur: 10500, base: 10000, classe: "monetaire", date_ouverture: "2016-09-12" }, "2026-10-14");
  assert.equal(ancien.impot_revenu, 0); proche(ancien.prelevements_sociaux, 86, 0.005);
});
test("PER : taux marginal absent → 30 % avec mention ; versements non déduits → seuls les gains sont imposés", () => {
  const c = { type: "per", valeur: 40000, base: 30000, versements_deduits: 30000, classe: "actions" };
  const s = sortie(c, "2026-10-14");
  proche(s.impot_revenu, 10280, 0.005);
  assert.ok(s.avertissements.some(m => m.includes("30 %")));
  assert.ok(s.avertissements.some(m => m.includes("bloqué")));
  const nd = sortie(c, "2026-10-14", { per_versements_deduits: false, tmi_pct: 41 });
  proche(nd.impot_revenu, 10000 * 0.128, 0.005);
  proche(sortie(c, "2026-10-14", { tmi_pct: 41 }).impot_revenu, 30000 * 0.41 + 1280, 0.005);
});
test("SCPI en direct et bien autre : abattements par durée de détention, bornes", () => {
  const base = { type: "scpi_direct", valeur: 60000, base: 50000, classe: "immobilier" };
  const a5 = sortie({ ...base, date_achat: "2021-10-14" }, "2026-10-14"); // 5 ans pleins : aucun abattement
  proche(a5.impot_revenu, 1900, 0.005); proche(a5.prelevements_sociaux, 1720, 0.005);
  const a6 = sortie({ ...base, date_achat: "2020-10-14" }, "2026-10-14"); // 6 ans : 6 % et 1,65 %
  proche(a6.impot_revenu, 10000 * 0.94 * 0.19, 0.005); proche(a6.prelevements_sociaux, 10000 * (1 - 0.0165) * 0.172, 0.005);
  const a22 = sortie({ ...base, date_achat: "2004-10-14" }, "2026-10-14"); // 22 ans : IR exonéré
  assert.equal(a22.impot_revenu, 0);
  const a30 = sortie({ ...base, date_achat: "1996-10-14" }, "2026-10-14");
  assert.equal(a30.prelevements_sociaux, 0);
  const sansDate = sortie(base, "2026-10-14");
  assert.ok(sansDate.avertissements.some(m => m.includes("date d'achat à compléter")));
  const bien = sortie({ type: "bien_autre", valeur: 300000, base: 200000, date_achat: "2016-10-14", classe: "immobilier" }, "2026-10-14");
  assert.equal(bien.confiance, "sure");
  assert.ok(bien.avertissements.every(m => !m.includes("SCPI")));
  const gros = sortie({ type: "bien_autre", valeur: 600000, base: 200000, classe: "immobilier" }, "2026-10-14");
  assert.ok(gros.avertissements.some(m => m.includes("surtaxe")));
});
test("règle sans repère : indisponible, brut inchangé, aucune valeur de secours", () => {
  for (const [type, retire] of [["pea", "pea_duree_ans"], ["assurance_vie", "av_taux_ir_reduit"], ["per", "ps_taux_general"], ["pee", "ps_taux_epargne_salariale"], ["scpi_direct", "pv_immo_ir_taux"], ["pel", "ir_taux_forfaitaire"]]) {
    const s = F.fiscaliteSortie({ type, valeur: 1000, base: 500, classe: "actions" }, "2026-10-14", { reperes: R.filter(r => r.cle !== retire) });
    assert.equal(s.regle, "indisponible", type);
    assert.equal(s.net, null); assert.equal(s.brut, 1000); assert.equal(s.total, 0);
    assert.ok(s.avertissements.some(m => m.includes("repère manquant") && m.includes(retire)), type);
  }
});
test("type inconnu : indisponible avec mention, sans règle inventée", () => {
  const s = F.fiscaliteSortie({ type: "bizarre", valeur: 1000, base: 500, classe: "actions" }, "2026-10-14", { reperes: R });
  assert.equal(s.regle, "indisponible");
});
test("les sources renvoyées sont celles des repères utilisés (titre, URL, vérifié le)", () => {
  const s = sortie({ type: "pea", valeur: 50000, base: 40000, classe: "actions", date_ouverture: "2020-01-10" }, "2026-10-14");
  assert.deepEqual(s.sources.map(x => x.cle).sort(), ["ir_taux_forfaitaire", "pea_duree_ans", "ps_taux_general"]);
  assert.ok(s.sources.every(x => /^https:\/\//.test(x.url) && x.verifie_le));
});
test("brutPourNet : exact pour les règles proportionnelles, dichotomie avec l'abattement de l'assurance-vie", () => {
  const ctx = { reperes: R, couple: true };
  const ct = { type: "compte_titres", valeur: 20000, base: 18000, classe: "actions" };
  const p = F.preparer(ct, ctx);
  const b = F.brutPourNet(p, ct, 10000, "2026-10-14");
  const o = p.calculer(b, 18000 * b / 20000, "2026-10-14");
  proche(b - o.ir - o.ps, 10000, 1e-6);
  const av = { type: "assurance_vie", valeur: 50000, base: 40000, classe: "fonds_euros", date_ouverture: "2017-06-01" };
  const pv = F.preparer(av, ctx);
  const b2 = F.brutPourNet(pv, av, 30000, "2026-10-14");
  const o2 = pv.calculer(b2, 40000 * b2 / 50000, "2026-10-14");
  proche(b2 - o2.ir - o2.ps, 30000, 1e-4);
  assert.equal(F.brutPourNet(pv, av, 60000, "2026-10-14"), 50000, "plus que le compartiment : tout");
});
