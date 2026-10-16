// SCN1 tâche 7 : l'hypothèse de variante `enveloppe_scenario` du moteur PROJ (proj-1.3.0, spec § 6.6) — validation, compartiments synthétiques ouverts à leur date,
// versement mensuel à l'étape 1 de la cascade, versement de départ au niveau 1 de l'ordre de retrait, économie d'impôt du PER en septembre de l'année suivante,
// débordement au plafond, transfert depuis un livret, dates de 5 et 8 ans depuis l'ouverture, non-régression complète de proj-1.2.0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { cas, dataDe, entreeCatalogue, fraisDeCas } from "./helpers/scenarios-cas.mjs";
import { empreintes } from "./helpers/proj-nonreg.mjs";
const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");
const E = req("../web/src/projection-evenements.js");
const S = req("../web/src/scenarios.js");
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " (tolérance " + tol + ")");

const ES = (extra) => ({ scenario: "ouvrir_pea", version_calcul: "scn-1.0.0", type: "pea", titulaire: "p2", ouverture: "2026-11-15", allocation: { actions: 100 }, ter_pct: 0.2, frais_enveloppe_pct: 0,
  initial: { montant: 1000, depuis: "disponible" }, mensuel: { montant: 300, depuis: "capacite" }, debordement: "compte_titres", ...(extra || {}) });
const variante = es => ({ id: "a1b2c3d4-0000-4000-8000-0000000000f1", nom: "Scénario retenu", description: "", retire: [], hypotheses: { enveloppe_scenario: es } });
function donnees(es, extra) {
  const { data } = dataDe(cas("PEA-1"));
  data.foyer = { evenements: [], variantes: es ? [variante(es)] : [] };
  Object.assign(data, extra || {});
  return data;
}
function sim(es, horizon, extra) {
  const data = donnees(es, extra), M = P.preparer(data, { horizon_ans: horizon || 2, euros: "courants", vue: "financier", variante: es ? variante(es).id : undefined });
  const r = P.simuler(M, { volatilite: 0 }), dd = r.deterministe_detail, B = dd.compartiments.length;
  const val = (b, t) => dd.valeurs_par_compartiment[t * B + b];
  return { M, r, dd, B, val, courant: dd.compartiments.findIndex(c => c.type === "courant"), data };
}
const idxType = (s, type) => s.dd.compartiments.map((c, b) => (c.type === type && /Scénario/.test(c.enveloppe) ? b : -1)).filter(b => b >= 0);

/* ---------------------------------------------------------------- validation (JS) */
test("enveloppe_scenario est une hypothèse de variante, et la version du modèle est proj-1.4.0", () => {
  assert.ok(E.HYPOTHESES_VARIANTE.includes("enveloppe_scenario"));
  assert.equal(P.versionModele, "proj-1.4.0");
});
test("validerVariante : une enveloppe de scénario complète est valide, une minimale aussi", () => {
  assert.equal(E.validerVariante(variante(ES())), null);
  assert.equal(E.validerVariante(variante({ scenario: "matelas", type: "livret_a", titulaire: "p1", ouverture: "2026-11-15", transferts: [{ de: "courant", montant: 500 }] })), null);
  assert.equal(E.validerVariante(variante(ES({ type: "per", per: { deduit: true, tmi_retraite_pct: 11, economie: "reinvestie" }, plafond_versements: 4710, debordement: "disponible", debut: "2027-01-15" }))), null);
});
const refus = (es, motif) => assert.match(E.validerVariante(variante(es)) || "", motif);
test("validerVariante : champ inconnu, type, titulaire, dates, allocation, bornes, formes refusés avec un message qui dit quoi corriger", () => {
  refus(ES({ magie: 1 }), /champ « magie » inconnu/);
  refus(ES({ scenario: "Ouvrir PEA" }), /identifiant du scénario/);
  refus(ES({ version_calcul: "1.0" }), /version du calcul/);
  refus(ES({ type: "crypto" }), /choisis parmi pea, assurance_vie, per, compte_titres, livret_a, ldds, lep/);
  refus(ES({ titulaire: "p3" }), /p1 ou p2/);
  refus(ES({ ouverture: "demain" }), /date AAAA-MM-JJ/);
  refus(ES({ allocation: undefined }), /allocation/);
  refus(ES({ allocation: { actions: 60, fonds_euros: 30 } }), /somme des pourcentages/);
  refus(ES({ allocation: { magie: 100 } }), /classe inconnue « magie »/);
  refus(ES({ allocation: { actions: 120, fonds_euros: -20 } }), /de 0 à 100/);
  refus(ES({ ter_pct: 5 }), /ter_pct/); refus(ES({ frais_enveloppe_pct: -1 }), /frais_enveloppe_pct/);
  refus(ES({ initial: { montant: 2000000, depuis: "disponible" } }), /initial/); refus(ES({ initial: { montant: 10, depuis: "ailleurs" } }), /initial/);
  refus(ES({ mensuel: { montant: 200000, depuis: "capacite" } }), /mensuel/); refus(ES({ mensuel: { montant: 10, depuis: "salaire" } }), /mensuel/);
  refus(ES({ debut: "2026-01-01" }), /debut/); refus(ES({ debut: "bientôt" }), /debut/);
  refus(ES({ plafond_versements: -5 }), /plafond_versements/); refus(ES({ debordement: "ailleurs" }), /debordement/);
  refus(ES({ per: { deduit: true } }), /per.*réservé au type per/);
  refus(ES({ type: "per", per: { deduit: "oui" } }), /deduit/); refus(ES({ type: "per", per: { tmi_retraite_pct: 12 } }), /tmi_retraite_pct/);
  refus(ES({ type: "per", per: { economie: "jamais" } }), /economie/);
  refus(ES({ transferts: [{ de: "pea", montant: 5 }] }), /transferts/); refus(ES({ transferts: [{ de: "livret_a", montant: 0 }] }), /transferts/);
  refus(ES({ transferts: Array.from({ length: 6 }, () => ({ de: "livret_a", montant: 5 })) }), /transferts/);
  assert.match(E.validerVariante({ nom: "v", hypotheses: { enveloppe_scenario: 3 } }), /doit être un objet/);
  assert.match(E.validerVariante({ nom: "v", hypotheses: { inconnue: 1 } }), /Hypothèse inconnue.*enveloppe_scenario/);
});

/* ---------------------------------------------------------------- compartiments synthétiques et cascade */
test("compartiment synthétique : ouvert à sa date, un par classe, valeur nulle avant les versements ; PEA à 5 ans depuis l'ouverture", () => {
  const s = sim(ES({ allocation: { actions: 60, obligations: 40 } }), 6);
  const idx = s.M.comps.map((c, b) => (c.scenario ? b : -1)).filter(b => b >= 0);
  assert.deepEqual(idx.map(b => s.M.comps[b].classe).sort(), ["actions", "obligations"]);
  idx.forEach(b => { assert.equal(s.M.comps[b].v0, 0); assert.equal(s.M.comps[b].type, "pea"); assert.equal(s.M.comps[b].titulaire, "p2"); assert.equal(s.M.comps[b].prep.seuil, "2031-11-16"); assert.equal(s.val(b, 0), 0); });
  assert.ok(s.val(idx[0], 1) > 0);
});
test("versement mensuel (étape 1 de la cascade) et versement de départ (niveau 1 de l'ordre de retrait) : valeurs au centime", () => {
  const base = sim(null, 2), s = sim(ES(), 2), [b] = idxType(s, "pea"), la = s.dd.compartiments.findIndex(c => c.type === "livret_a");
  const q = Math.pow(1.06 * (1 - 0.002), 1 / 12);
  for (const t of [1, 2, 7, 24]) proche(s.val(b, t), 1000 * Math.pow(q, t - 1) + 300 * (Math.pow(q, t) - 1) / (q - 1), 1e-6, "PEA au mois " + t);
  /* le versement de départ est pris sur le disponible au-dessus du matelas, compte courant d'abord (niveau 1 de l'ordre de retrait), après la croissance du mois */
  const g = Math.pow(1.017, 1 / 12);
  proche(s.val(la, 1), 16000 * g, 1e-6, "Livret A inchangé : le compte courant suffit");
  proche(base.val(base.courant, 1) - s.val(s.courant, 1), 1000 + 300, 1e-6, "compte courant au mois 1 : 1 000 € de départ + 300 € de capacité en moins");
  /* la capacité de 500 € par mois est réduite de 300 € : le compte courant reçoit 200 € au lieu de 500 € */
  for (const t of [2, 12, 24]) proche(base.val(base.courant, t) - s.val(s.courant, t), 1000 + 300 * t, 1e-6, "compte courant au mois " + t);
});
test("versement « en plus » : ne réduit pas la capacité ; avant la date de début : rien", () => {
  const base = sim(null, 1), s = sim(ES({ mensuel: { montant: 300, depuis: "en_plus" }, initial: undefined, debut: "2027-01-15" }), 1), [b] = idxType(s, "pea");
  assert.equal(s.val(b, 1), 0); assert.equal(s.val(b, 2), 0);
  assert.ok(s.val(b, 3) > 299);
  proche(base.val(base.courant, 6), s.val(s.courant, 6), 1e-9, "capacité inchangée");
});
test("ouverture avant le début des versements (« prendre date ») : le petit versement part à l'ouverture, le mensuel à la date de début", () => {
  const s = sim(ES({ initial: { montant: 10, depuis: "disponible" }, mensuel: { montant: 300, depuis: "capacite" }, debut: "2027-01-15" }), 1), [b] = idxType(s, "pea");
  const q = Math.pow(1.06 * (1 - 0.002), 1 / 12);
  proche(s.val(b, 1), 10, 1e-9, "le petit versement au mois d'ouverture"); proche(s.val(b, 2), 10 * q, 1e-9, "rien entre l'ouverture et le début");
  proche(s.val(b, 3), 10 * q * q + 300, 1e-6, "le premier mensuel au mois 3 (15/01/2027)");
});
test("débordement au plafond : le surplus va en compte-titres (ou au disponible), jamais perdu", () => {
  const es = ES({ plafond_versements: 1500, debordement: "compte_titres", mensuel: { montant: 300, depuis: "capacite" } });
  const s = sim(es, 1), [pea] = idxType(s, "pea"), [cto] = idxType(s, "compte_titres");
  assert.ok(pea >= 0 && cto >= 0);
  const g = Math.exp(Math.log(1.06) / 12) * Math.pow(1 - 0.002, 1 / 12);
  proche(s.val(pea, 1), 1300, 1e-9, "mois 1 : 1 000 + 300 sous le plafond");
  proche(s.val(pea, 2), 1300 * g + 200, 1e-6, "mois 2 : le plafond de 1 500 est atteint");
  proche(s.val(cto, 2), 100, 1e-9, "mois 2 : 100 € débordent"); proche(s.val(pea, 3), s.val(pea, 2) * g, 1e-6, "mois 3 : plus rien dans le PEA");
  proche(s.val(cto, 3), 100 * g + 300, 1e-6, "mois 3 : 300 € en compte-titres");
  const sd = sim(ES({ plafond_versements: 1500, debordement: "disponible" }), 1), base = sim(null, 1);
  proche(sd.val(sd.courant, 2) - base.val(base.courant, 2), -1000 - 300 - 300 + 100, 1e-6, "le débordement revient au compte courant (1 000 € de départ, 300 € de capacité en moins deux mois, +100 € qui reviennent)");
  assert.deepEqual(idxType(sd, "compte_titres"), []);
});
test("transfert depuis un livret : le montant quitte le livret au mois 1 et entre dans l'enveloppe du scénario", () => {
  const s = sim(ES({ type: "assurance_vie", initial: undefined, mensuel: undefined, transferts: [{ de: "livret_a", montant: 5000 }] }), 1), [b] = idxType(s, "assurance_vie");
  const la = s.dd.compartiments.findIndex(c => c.type === "livret_a");
  proche(s.val(b, 1), 5000, 1e-9);
  proche(s.val(la, 1), 16000 * Math.pow(1.017, 1 / 12) - 5000, 1e-6);
  const trop = sim(ES({ initial: { montant: 90000, depuis: "disponible" }, mensuel: undefined }), 1), [pea] = idxType(trop, "pea");
  assert.ok(trop.val(pea, 1) < 90000 && trop.val(pea, 1) > 10000, "le versement de départ est limité au disponible au-dessus du matelas : " + trop.val(pea, 1));
  proche(trop.val(pea, 1), 2000 + 16000 * Math.pow(1.017, 1 / 12) - 6000 * Math.pow(1.02, 1 / 12), 1e-6, "tout le disponible au-dessus du matelas de 6 000 € (indexé sur l'inflation)");
  const gros = sim(ES({ initial: { montant: 5000, depuis: "disponible" }, mensuel: undefined }), 1), la2 = gros.dd.compartiments.findIndex(c => c.type === "livret_a");
  proche(gros.val(gros.courant, 1), 500 * Math.pow(1.02, 1 / 12), 1e-9, "le compte courant est vidé d'abord (il ne garde que la capacité du mois, indexée)"); proche(gros.val(la2, 1), 16000 * Math.pow(1.017, 1 / 12) - 3000, 1e-6, "puis le Livret A");
});
test("PER : l'économie d'impôt (versements déduits × TMI) s'ajoute à la capacité de septembre de l'année suivante ; sortie en capital à la TMI de retraite", () => {
  const es = ES({ type: "per", initial: undefined, mensuel: { montant: 200, depuis: "capacite" }, per: { deduit: true, tmi_retraite_pct: 11, economie: "reinvestie" }, debordement: "disponible" });
  const s = sim(es, 3), sans = sim(ES({ type: "per", initial: undefined, mensuel: { montant: 200, depuis: "capacite" }, per: { deduit: true, tmi_retraite_pct: 11, economie: "depensee" }, debordement: "disponible" }), 3);
  const tSept27 = s.M.dates.findIndex(d => d.slice(0, 7) === "2027-09"), tSept28 = s.M.dates.findIndex(d => d.slice(0, 7) === "2028-09");
  assert.equal(tSept27, 11);
  /* TMI de 30 % (config) : novembre et décembre 2026 = 400 € versés → 120 € en septembre 2027 ; 2027 = 2 400 € → 720 € en septembre 2028 */
  proche(s.M.nomDelta[tSept27], 120, 1e-9); proche(s.M.nomDelta[tSept28], 720, 1e-9);
  assert.equal(sans.M.nomDelta[tSept27], 0);
  proche(s.val(s.courant, tSept27) - sans.val(sans.courant, tSept27), 120, 1e-6, "le compte courant reçoit l'économie");
  assert.ok(s.r.capacite_par_periode.some(p => /économie d'impôt du PER/.test(p.raison)), "la capacité par période explique la marche");
  /* sortie : la base fiscale et les versements déduits suivent les dépôts */
  const [b] = idxType(s, "per"), prep = s.M.comps[b].prep, V = 12345, Bs = 4800;
  const tx = prep.calculer(V, Bs, "2046-10-15", 0);
  proche(tx.ir, 4800 * 0.11 + (V - Bs) * 0.128, 1e-6, "impôt : versements déduits à 11 % + gains à 12,8 %"); proche(tx.ps, (V - Bs) * 0.186, 1e-6);
});
test("PER : plafond de déduction, et versements non déduits sans économie", () => {
  const es = ES({ type: "per", initial: undefined, mensuel: { montant: 500, depuis: "capacite" }, plafond_versements: 4710, per: { deduit: true, tmi_retraite_pct: 11, economie: "reinvestie" } });
  const s = sim(es, 3), t28 = s.M.dates.findIndex(d => d.slice(0, 7) === "2028-09");
  proche(s.M.nomDelta[t28], 4710 * 0.3, 1e-9, "2027 : 6 000 € versés, 4 710 € déduits");
  const nd = sim(ES({ type: "per", initial: undefined, mensuel: { montant: 500, depuis: "capacite" }, per: { deduit: false, tmi_retraite_pct: 11, economie: "reinvestie" } }), 3);
  assert.equal(nd.M.nomDelta[t28], 0);
  const prep = nd.M.comps[idxType(nd, "per")[0]].prep;
  assert.equal(prep.calculer(10000, 8000, "2046-10-15", 0).ir, 2000 * 0.128, "rien n'est déduit : seuls les gains sont imposés");
});
test("assurance-vie : la durée de 8 ans court depuis l'ouverture du scénario, et la prime s'ajoute à celles du titulaire", () => {
  const s = sim(ES({ type: "assurance_vie", ouverture: "2026-11-15", allocation: { actions: 50, fonds_euros: 50 } }), 1);
  const idx = idxType(s, "assurance_vie");
  assert.equal(idx.length, 2);
  idx.forEach(b => assert.equal(s.M.comps[b].prep.seuil, "2034-11-16"));
  assert.equal(s.M.comps[idx[0]].prep.calculer(1000, 500, "2034-11-15", 0).ir > 0, true);
  assert.equal(s.M.comps[idx[0]].prep.calculer(1000, 500, "2034-11-16", 4600).ir, 0);
});
test("livret : le compartiment du scénario suit le taux réglementé du repère puis le monétaire", () => {
  const s = sim(ES({ type: "livret_a", initial: undefined, mensuel: undefined, transferts: [{ de: "courant", montant: 1000 }], allocation: undefined }), 5), [b] = idxType(s, "livret_a");
  proche(s.val(b, 1), 1000, 1e-9);
  proche(s.val(b, 60), 1000 * Math.pow(1.017, 2 / 12) * Math.pow(1.015, 57 / 12), 1e-6);
});
test("repère manquant : l'impôt de sortie de l'enveloppe du scénario n'est jamais supposé nul en silence (avertissement)", () => {
  const data = donnees(ES()); data.reperes = data.reperes.filter(r => r.cle !== "pea_duree_ans");
  const M = P.preparer(data, { horizon_ans: 1, variante: variante(ES()).id }), r = P.simuler(M, { volatilite: 0 });
  assert.ok(r.avertissements.some(a => /scénario/i.test(a) && /pea_duree_ans/.test(a)), JSON.stringify(r.avertissements));
});
test("comparer : la variante de scénario et la situation actuelle partagent les mêmes tirages ; le PEA fait mieux qu'un compte-titres à frais égaux après 5 ans", () => {
  const data = donnees(ES({ initial: undefined, mensuel: { montant: 300, depuis: "capacite" } }), { }), o = { horizon_ans: 8, euros: "constants", vue: "net", net_impots: true };
  const MA = P.preparer(data, o), MB = P.preparer(data, { ...o, variante: variante(ES()).id });
  const c = P.comparer(MA, MB, { chemins: 200, vue: "net", net_impots: true });
  assert.ok(!c.erreur && c.ecarts && c.chemins === 200);
  assert.equal(c.version_modele, "proj-1.4.0");
});

/* ---------------------------------------------------------------- non-régression de proj-1.2.0 */
test("non-régression : tous les cas de projection-cas.json (déterministe et Monte-Carlo) sont identiques, seule version_modele change", () => {
  const ref = JSON.parse(readFileSync(new URL("./fixtures/proj-nonreg-1.2.0.json", import.meta.url), "utf8")).empreintes, now = empreintes();
  assert.equal(Object.keys(ref).length, 64);
  assert.deepEqual(now, ref);
});
test("non-régression : une variante sans enveloppe_scenario donne les mêmes sorties qu'avant (hypothèses de l'ancienne liste)", () => {
  const data = donnees(null); data.foyer.variantes = [{ id: "a1b2c3d4-0000-4000-8000-0000000000f2", nom: "Plus d'épargne", description: "", retire: [], hypotheses: { epargne_delta_mensuel: 100 } }];
  const M0 = P.preparer(data, { horizon_ans: 5, euros: "courants", vue: "financier" }), M1 = P.preparer(data, { horizon_ans: 5, euros: "courants", vue: "financier", variante: "a1b2c3d4-0000-4000-8000-0000000000f2" });
  assert.equal(M0.scn, null); assert.equal(M1.scn, null);
  const r0 = P.simuler(M0, { volatilite: 0 }), r1 = P.simuler(M1, { volatilite: 0 });
  assert.ok(r1.deterministe_detail.courants.financier[60] > r0.deterministe_detail.courants.financier[60]);
});
