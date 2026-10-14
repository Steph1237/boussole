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

/* ---------------------------------------------------------------- ordre de retrait (§ 6.3) : cas R-1 à R-4 et net d'impôts dans la projection */
const Pr = createRequire(import.meta.url)("../web/src/projection.js");
import { cas, entreeDe } from "./helpers/projection-cas.mjs";
test("R-1 : apport net de 60 000 € — disponible au-dessus du matelas, puis compte-titres, puis assurance-vie (coût fiscal croissant) ; PEA intact", () => {
  const c = cas("R-1"), a = c.attendu, r = Pr.retrait(entreeDe(c), c.options);
  assert.equal(r.pea_intact, a.pea_intact); proche(r.impots, a.impots, 0.01); proche(r.manque, a.manque, 0.01);
  assert.deepEqual(r.ordre_niveau_2, a.ordre_niveau_2.map(x => x));
  for (const s of a.sources) {
    const x = r.sources.find(y => y.enveloppe === s.enveloppe);
    proche(x.brut, s.brut, 0.01, s.enveloppe); proche(x.impots, s.impots != null ? s.impots : x.impots, 0.01, s.enveloppe);
    if (s.gain != null) { proche(x.gain, s.gain, 0.01); proche(x.impot_revenu, s.impot_revenu, 0.01); proche(x.prelevements_sociaux, s.prelevements_sociaux, 0.01); }
    if (s.net != null) proche(x.net, s.net, 0.01);
  }
});
test("R-2 : 150 000 € — PEA de 3 ans protégé, mobilisable 97 592 €, il manque 52 408 €", () => {
  const c = cas("R-2"), a = c.attendu, r = Pr.retrait(entreeDe(c), c.options);
  proche(r.mobilisable, a.mobilisable, 0.01); proche(r.manque, a.manque, 0.01); assert.equal(r.pea_intact, true);
  assert.ok(r.avertissements.includes(a.avertissement_contient));
  const av = r.sources.find(s => /Assurance/.test(s.enveloppe));
  proche(av.brut, a.assurance_vie.brut, 0.01); proche(av.impot_revenu, a.assurance_vie.impot_revenu, 0.01); proche(av.prelevements_sociaux, a.assurance_vie.prelevements_sociaux, 0.01); proche(av.net, a.assurance_vie.net, 0.01);
});
test("R-3 : 120 000 € avec clôture du PEA autorisée — le plan est liquidé, l'excédent revient au disponible", () => {
  const c = cas("R-3"), a = c.attendu, r = Pr.retrait(entreeDe(c), c.options);
  const pea = r.sources.find(s => /PEA/.test(s.enveloppe));
  proche(pea.brut, a.pea.brut, 0.01); proche(pea.impots, a.pea.impots, 0.01); proche(pea.net, a.pea.net, 0.01); assert.equal(pea.cloture, true);
  proche(r.besoin_couvert_par_pea, a.besoin_couvert_par_pea, 0.01); proche(r.excedent_au_disponible, a.excedent_au_disponible, 0.01); proche(r.manque, a.manque, 0.01);
});
test("R-4 : PER mobilisable pour la résidence principale seulement", () => {
  const c = cas("R-4"), a = c.attendu;
  const rp = Pr.retrait(entreeDe(c), { ...c.options, usage: "rp" }), loc = Pr.retrait(entreeDe(c), { ...c.options, usage: "locatif" });
  proche(rp.per.brut, a.rp.per.brut, 0.01); proche(rp.per.impots, a.rp.per.impots, 0.01); proche(rp.per.net, a.rp.per.net, 0.01);
  proche(rp.matelas_utilise, a.rp.matelas_utilise, 0.01); proche(rp.manque, a.rp.manque, 0.01); assert.equal(rp.pea_intact, true);
  assert.equal(loc.per, null); proche(loc.mobilisable, a.locatif.mobilisable, 0.01); proche(loc.manque, a.locatif.manque, 0.01);
});
test("ordre de retrait : les dates du calendrier changent l'ordre dans le temps (PEA mobilisable sans clôture après 5 ans)", () => {
  const c = cas("R-2"), d = entreeDe(c);
  const avant = Pr.retrait(d, { ...c.options, montant_net: 150000 });
  assert.equal(avant.pea_intact, true);
  d.config.enveloppes_infos["PEA Exemple"].date_ouverture = "2020-09-01";
  const apres = Pr.retrait(d, { ...c.options, montant_net: 150000 });
  assert.equal(apres.pea_intact, false, "un PEA de plus de 5 ans est mobilisable sans clôture");
  assert.ok(apres.manque < avant.manque);
});
test("net d'impôts dans la projection : égal à la brute pour les livrets, inférieur pour les gains imposables ; repère manquant → brut et mention", () => {
  const c = cas("C-1"), d = entreeDe(c);
  const brut = Pr.simuler(Pr.preparer(d, { ...c.options, vue: "financier" }), { volatilite: 0 }), net = Pr.simuler(Pr.preparer(d, { ...c.options, vue: "financier", net_impots: true }), { volatilite: 0 });
  assert.ok(net.vues.financier.p50[120] < brut.vues.financier.p50[120]);
  assert.equal(net.net_impots, true);
  /* assurance-vie de 2015, 50 000 € à 2,5 % et 40 000 € de primes : après 10 ans, 83 004 € dont 43 004 € de gain, abattement de 9 200 € du couple */
  const gain = 50000 * Math.pow(1.025, 10) - 40000, attendu = gain * 0.172 + Math.max(0, gain - 9200) * 0.075;
  proche(brut.vues.financier.p50[120] - net.vues.financier.p50[120], attendu, 0.5);
  const sans = JSON.parse(JSON.stringify(d)); sans.reperes = sans.reperes.filter(r => r.cle !== "ps_taux_av_epargne_logement");
  const r = Pr.simuler(Pr.preparer(sans, { ...c.options, vue: "financier", net_impots: true }), { volatilite: 0 });
  proche(r.vues.financier.p50[120], brut.vues.financier.p50[120], 1e-6, "compartiment laissé en brut");
});
