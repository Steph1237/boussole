// Moteur : « autres biens » (biens d'usage et d'entreprise du profil) dans le patrimoine net, à valeur constante en euros d'aujourd'hui (aucune hypothèse de dépréciation),
// dite dans les avertissements ; la phrase du moteur et le connecteur parlent du même patrimoine net que l'app. Textes d'objectif (« plus de 9 chances sur 10 »)
// et effet d'une naissance (signe selon le sens, âges exacts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cas, entreeDe } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");
const J = o => JSON.parse(JSON.stringify(o));

const base = () => entreeDe(cas("C-4"));
const avecAutres = (usage, entreprise) => { const d = J(base()); d.profil.autres = { p1: { usage, entreprise: entreprise || 0 }, p2: { usage: 0, entreprise: 0 } }; return d; };
const det = (d, o) => P.simuler(P.preparer(d, Object.assign({ horizon_ans: 10, vue: "net" }, o)), { volatilite: 0 });

test("autres biens : comptés dans le patrimoine net du moteur dès aujourd'hui (le même chiffre que le patrimoine net affiché)", () => {
  const sans = det(base()), avec = det(avecAutres(15000, 5000));
  assert.ok(Math.abs(avec.vues.net.p50[0] - sans.vues.net.p50[0] - 20000) < 1e-6, "+ 15 000 € d'usage et 5 000 € d'entreprise au mois 0");
  const fin = det(avecAutres(15000), { vue: "financier" }), fin0 = det(base(), { vue: "financier" });
  assert.equal(fin.vues.financier.p50[0], fin0.vues.financier.p50[0], "la vue financière n'est pas touchée");
  assert.equal(det(avecAutres(15000), { vue: "disponible" }).vues.disponible.p50[0], det(base(), { vue: "disponible" }).vues.disponible.p50[0]);
});

test("autres biens : valeur constante en euros d'aujourd'hui (0 % réel), donc l'écart avec le cas sans eux reste de 15 000 € en euros constants ; en euros courants il suit l'inflation", () => {
  const sans = det(base()), avec = det(avecAutres(15000));
  for (const t of [12, 60, 120]) assert.ok(Math.abs(avec.vues.net.p50[t] - sans.vues.net.p50[t] - 15000) < 1e-6, "mois " + t);
  const sc = det(base(), { euros: "courants" }), ac = det(avecAutres(15000), { euros: "courants" });
  const infl = Math.pow(1 + sc.hypotheses.find(h => h.cle === "inflation_hypothese").valeur / 100, 10);
  assert.ok(Math.abs(ac.vues.net.p50[120] - sc.vues.net.p50[120] - 15000 * infl) < 1, "courants : 15 000 € d'aujourd'hui × inflation");
});

test("autres biens : la couche « existant » les compte aussi (la décomposition retombe sur le total) ; net d'impôts : aucun impôt sur eux", () => {
  const r = P.simuler(P.preparer(avecAutres(15000), { horizon_ans: 5, vue: "net" }), { chemins: 100 });
  const s = P.simuler(P.preparer(base(), { horizon_ans: 5, vue: "net" }), { chemins: 100 });
  assert.ok(Math.abs(r.existant.p50[12] - s.existant.p50[12] - 15000) < 1e-6);
  assert.ok(Math.abs(r.epargne_future.p50[12] - s.epargne_future.p50[12]) < 1e-6, "l'épargne future ne change pas");
  const ni = P.simuler(P.preparer(avecAutres(15000), { horizon_ans: 5, vue: "net", net_impots: true }), { volatilite: 0 }), ni0 = P.simuler(P.preparer(base(), { horizon_ans: 5, vue: "net", net_impots: true }), { volatilite: 0 });
  assert.ok(Math.abs(ni.vues.net.p50[60] - ni0.vues.net.p50[60] - 15000) < 1e-6);
});

test("autres biens : dits dans les avertissements (net seulement), avec le montant et l'absence de dépréciation ; rien sans eux", () => {
  const r = det(avecAutres(15000, 5000));
  const a = r.avertissements.find(x => /biens d'usage et d'entreprise/.test(x));
  assert.ok(a, r.avertissements.join(" | ")); assert.match(a.replace(/[  ]/g, " "), /20 000 €/); assert.match(a, /valeur constante en euros d'aujourd'hui/); assert.match(a, /aucune dépréciation/);
  assert.ok(!det(avecAutres(15000), { vue: "financier" }).avertissements.some(x => /biens d'usage/.test(x)));
  assert.ok(!det(base()).avertissements.some(x => /biens d'usage/.test(x)));
});

test("autres biens : une personne ne compte que les siens (périmètre)", () => {
  const d = J(base()); d.profil.autres = { p1: { usage: 10000 }, p2: { usage: 4000 } };
  const f = det(d, { perimetre: "foyer" }), p1 = det(d, { perimetre: "p1" }), p2 = det(d, { perimetre: "p2" });
  const sans = det(base(), { perimetre: "foyer" });
  assert.ok(Math.abs(f.vues.net.p50[0] - sans.vues.net.p50[0] - 14000) < 1e-6);
  assert.ok(p1.vues.net.p50[0] - det(base(), { perimetre: "p1" }).vues.net.p50[0] === 10000 && p2.vues.net.p50[0] - det(base(), { perimetre: "p2" }).vues.net.p50[0] === 4000);
});

test("objectif : « plus de 9 chances sur 10 » dès 95 % (jamais « 10 chances sur 10 ») ; atteint : « déjà atteinte »", () => {
  const d = J(base());
  const objectifsDe = (cible, deja) => { const o = J(d); o.objectifs = [{ id: "o", nom: "Test", type: "autre", cible, dateCible: "2028-06-30", source: "saisi", deja, rendement: 0 }]; return P.simuler(P.preparer(o, { horizon_ans: 5, vue: "financier" }), { chemins: 200 }); };
  const facile = objectifsDe(1000, 0), j = facile.jalons.find(x => x.id === "objectif:o");
  if (j) { assert.doesNotMatch(j.effet.texte, /10 chances sur 10/); assert.match(j.effet.texte, /plus de 9 chances sur 10|déjà atteinte/); }
  assert.equal(typeof P.texteProbabilite, "function");
  assert.equal(P.texteProbabilite(1), "plus de 9 chances sur 10"); assert.equal(P.texteProbabilite(0.95), "plus de 9 chances sur 10"); assert.equal(P.texteProbabilite(0.94), "9 chances sur 10");
  assert.equal(P.texteProbabilite(0.8), "8 chances sur 10"); assert.equal(P.texteProbabilite(0.1), "1 chance sur 10"); assert.equal(P.texteProbabilite(0.02), "moins de 1 chance sur 10");
});

test("naissance : effet écrit par palier, signe selon le sens (− quand la dépense monte, + quand elle disparaît), âges exacts, jamais de double signe", () => {
  const c = cas("D-8"), d = J(entreeDe(c));
  d.foyer.evenements[0].date = "2024-10-10"; // enfant de 2 ans : 600 €/mois déjà dans les dépenses d'aujourd'hui
  const j = P.simuler(P.preparer(d, c.options), { volatilite: 0 }).jalons.find(x => x.type === "naissance");
  assert.equal(j.effet.texte.replace(/[  ]/g, " "), "−400 €/mois à partir de 14 ans, +600 €/mois à partir de 20 ans");
  d.foyer.evenements[0].date = "2027-04-10"; // à naître : le premier palier part de la naissance, sans âge
  const f = P.simuler(P.preparer(d, c.options), { volatilite: 0 }).jalons.find(x => x.type === "naissance");
  assert.equal(f.effet.texte.replace(/[  ]/g, " "), "−600 €/mois, −1 000 €/mois à partir de 14 ans");
});
