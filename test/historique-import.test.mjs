// HIS2 : HistoriqueImport (normalisation, contrôles, empreinte, clés naturelles, doublons, résumé) sur les cas de test/fixtures/his2-cas.json.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parFonction, cas, resoudre, contexteDe, contientTous, HistoriqueImport as H, TAXONOMIE_FIXTURE } from "./helpers/his2.mjs";

const verifier = c => H.verifier(c.type, resoudre(c.entree), contexteDe(c));

/** Comparaison « champs donnés seulement » d'un objet normalisé : sous-objet récursif, listes de même longueur. */
function contient(actuel, attendu, chemin) {
  if (Array.isArray(attendu)) {
    assert.ok(Array.isArray(actuel), chemin + " : liste attendue");
    assert.equal(actuel.length, attendu.length, chemin + " : longueur " + JSON.stringify(actuel).slice(0, 300));
    attendu.forEach((a, i) => contient(actuel[i], a, chemin + "[" + i + "]"));
  } else if (attendu && typeof attendu === "object") {
    assert.ok(actuel && typeof actuel === "object", chemin + " : objet attendu");
    for (const [k, v] of Object.entries(attendu)) {
      if (k === "nom_commence_par") assert.ok(actuel.nom.startsWith(v), chemin + " : nom commence par " + v + " (" + actuel.nom + ")");
      else if (k === "nom_longueur_max") assert.ok(actuel.nom.length <= v, chemin + " : nom ≤ " + v);
      else if (k === "texte_contient") assert.ok(contientTous(actuel.texte, v), chemin + " : texte « " + actuel.texte + " » contient " + JSON.stringify(v));
      else if (/^mouvements_\d+$/.test(k)) contient(actuel.mouvements[+k.split("_")[1]], v, chemin + ".mouvements[" + k.split("_")[1] + "]");
      else contient(actuel[k], v, chemin + "." + k);
    }
  } else if (typeof attendu === "number") assert.ok(Math.abs(actuel - attendu) < 0.0101, chemin + " : " + actuel + " ≠ " + attendu);
  else assert.equal(actuel, attendu, chemin);
}

const correspond = (b, a) => (a.chemin === undefined || b.chemin === a.chemin) && contientTous(b.message, a.message_contient);
function comparerBloquants(c, r) {
  const att = c.attendu.bloquants;
  if (att === undefined) return;
  if (c.attendu.bloquants_exhaustif === false) att.forEach(a => assert.ok(r.bloquants.some(b => correspond(b, a)), c.id + " : bloquant attendu " + JSON.stringify(a) + " parmi " + JSON.stringify(r.bloquants)));
  else {
    assert.equal(r.bloquants.length, att.length, c.id + " : bloquants " + JSON.stringify(r.bloquants));
    att.forEach((a, i) => assert.ok(correspond(r.bloquants[i], a), c.id + " : bloquant " + i + " " + JSON.stringify(r.bloquants[i]) + " ≠ " + JSON.stringify(a)));
  }
}
function comparerAvertissements(c, r) {
  const att = c.attendu.avertissements;
  if (att === undefined) return;
  const trouve = a => r.avertissements.find(w => w.cle === a.cle && (!a.donnees || Object.entries(a.donnees).every(([k, v]) => (typeof v === "number" ? Math.abs(w.donnees[k] - v) < 0.0101 : JSON.stringify(w.donnees[k]) === JSON.stringify(v)))));
  if (c.attendu.avertissements_exhaustif !== false) assert.equal(r.avertissements.length, att.length, c.id + " : avertissements " + JSON.stringify(r.avertissements.map(w => w.cle)));
  att.forEach(a => {
    const w = trouve(a);
    assert.ok(w, c.id + " : avertissement attendu " + JSON.stringify(a) + " parmi " + JSON.stringify(r.avertissements));
    assert.ok(contientTous(w.message, a.message_contient), c.id + " : message « " + w.message + " » contient " + JSON.stringify(a.message_contient));
  });
}

for (const c of parFonction("controler")) {
  test("controler " + c.id + " : " + c.nom, () => {
    const r = verifier(c);
    comparerBloquants(c, r);
    comparerAvertissements(c, r);
    if (c.attendu.normalise) contient(r.contenu, c.attendu.normalise, "normalise");
    if (c.attendu.resume) contient(r.resume, c.attendu.resume, "resume");
    if (c.attendu.quantites) contient(r.quantites, c.attendu.quantites, "quantites");
  });
}

test("empreinte : le même contenu donne la même empreinte, un centime ou un prix de différence la change (relations de la fixture)", () => {
  for (const c of parFonction("empreinte")) {
    const mine = verifier(c).empreinte;
    assert.match(mine, /^[0-9a-f]{64}$/, c.id);
    for (const id of c.attendu.meme_que || []) assert.equal(mine, verifier(cas(id)).empreinte, c.id + " = " + id);
    for (const id of c.attendu.differente_de || []) assert.notEqual(mine, verifier(cas(id)).empreinte, c.id + " ≠ " + id);
  }
});

test("empreinte : asynchrone (Promise) et égale à la version immédiate", async () => {
  const c = cas("B1"), r = verifier(c);
  assert.equal(await H.empreinte(c.type, r.contenu), r.empreinte);
});

test("sha256Hex : égal à celui de node:crypto (UTF-8, longueurs de bloc limites)", () => {
  for (const t of ["", "abc", "é".repeat(100), "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "€ ".repeat(500)])
    assert.equal(H.sha256Hex(t), createHash("sha256").update(t).digest("hex"));
});

for (const c of parFonction("clesNaturelles")) {
  test("clesNaturelles " + c.id + " : " + c.nom, () => {
    const ctx = contexteDe(c), r = verifier(c), M = r.contenu.mouvements;
    if (c.attendu.rangs) assert.deepEqual(M.map(m => m.rang), c.attendu.rangs);
    if (c.attendu.cles_distinctes !== undefined) assert.equal(new Set(M.map(m => m.cle_import)).size, c.attendu.cles_distinctes);
    M.forEach(m => assert.match(m.cle_import, /^[0-9a-f]{32}$/));
    const cl = H.classerParCle(M, ctx.transactions);
    assert.deepEqual([cl.nouveaux, cl.ignores], [c.attendu.nouveaux, c.attendu.ignores]);
    assert.deepEqual(H.clesNaturelles(M).map(m => m.cle_import), M.map(m => m.cle_import), "idempotente");
  });
}

for (const c of parFonction("doublons")) {
  test("doublons " + c.id + " : " + c.nom, () => {
    const ctx = contexteDe(c), r = verifier(c);
    const d = H.doublons(r.contenu.mouvements, ctx.transactions, ctx.positions);
    assert.equal(d.length, c.attendu.doublons.length, JSON.stringify(d));
    c.attendu.doublons.forEach((a, i) => {
      assert.equal(d[i].transaction_id, a.transaction_id);
      assert.equal(d[i].mouvement, a.mouvement);
      assert.equal(d[i].mouvement_cle, r.contenu.mouvements[a.mouvement].cle_import);
      assert.equal(d[i].ecart_jours, a.ecart_jours);
      assert.ok(Math.abs(d[i].ecart_eur - a.ecart_eur) < 0.0101, "ecart_eur " + d[i].ecart_eur);
    });
  });
}

test("taxonomie : sans BUD1, seules les 12 catégories larges sont admises (sous-catégorie vide) ; avec la taxonomie, une clé large seule est refusée", () => {
  assert.equal(H.CATEGORIES_LARGES.length, 12);
  const c = cas("B-avant-bud1"), entree = resoudre(c.entree);
  assert.equal(H.verifier("releves", entree, { today: c.today, taxonomie: "large" }).bloquants.length, 0);
  assert.equal(H.verifier("releves", entree, { today: c.today }).bloquants.length, 0, "sans contexte.taxonomie ni BudgetCategories : larges seulement");
  const avec = H.verifier("releves", entree, { today: c.today, taxonomie: TAXONOMIE_FIXTURE });
  assert.equal(avec.bloquants.length, 2, "revenus et alimentation sont refusés avec la taxonomie fine");
  globalThis.BudgetCategories = TAXONOMIE_FIXTURE; // point d'intégration : le global chargé par BUD1
  try { assert.equal(H.verifier("releves", entree, { today: c.today }).bloquants.length, 2, "BudgetCategories global pris tel quel"); }
  finally { delete globalThis.BudgetCategories; }
});

test("versApres : forme du contrat de la migration 0034, aucun contenu sensible dans les avertissements ni le résumé, moins de 100 000 octets", () => {
  const CLES_APRES = ["type", "empreinte", "fichier", "etablissement", "etablissement_libre", "compte", "enveloppe", "periode", "donnees", "lignes_a_creer", "doublons", "resume", "avertissements"];
  let n = 0;
  for (const c of parFonction("controler")) {
    const r = verifier(c);
    if (r.bloquants.length) continue;
    const apres = H.versApres(c.type, r.contenu, { empreinte: r.empreinte, resume: r.resume, avertissements: r.avertissements, doublons: r.doublons, today: c.today });
    n++;
    for (const k of Object.keys(apres)) assert.ok(CLES_APRES.includes(k), c.id + " : clé « " + k + " » hors contrat");
    assert.match(apres.empreinte, /^[0-9a-f]{64}$/);
    assert.ok(apres.periode.du <= apres.periode.au, c.id);
    assert.ok(!H.sensible(JSON.stringify(apres.avertissements), false) && !H.sensible(JSON.stringify(apres.resume), false), c.id + " : contenu sensible dans le résumé ou les avertissements");
    assert.ok(new TextEncoder().encode(JSON.stringify(apres)).length < H.LIMITES.PROPOSITION_OCTETS, c.id);
    if (c.type === "releves") {
      assert.ok(apres.compte && apres.donnees.mois.length, c.id);
      apres.donnees.mois.forEach(m => assert.deepEqual(Object.keys(m).sort(), ["categories", "complet", "controle", "mois"]));
    } else {
      assert.equal(typeof apres.enveloppe, "string", c.id);
      apres.donnees.mouvements.forEach(m => {
        assert.match(m.cle_import, /^[0-9a-f]{32}$/);
        assert.ok(m.position_id || m.isin || m.enveloppe, c.id + " : un mouvement doit désigner une ligne, un ISIN à créer ou une enveloppe");
        for (const k of Object.keys(m)) assert.ok(["cle_import", "date", "type", "position_id", "isin", "enveloppe", "qty", "price", "amount", "frais", "estime", "note", "devise"].includes(k), c.id + " : " + k);
      });
    }
  }
  assert.ok(n >= 25, "au moins 25 cas valides parcourus (" + n + ")");
});

test("limites : celles de la spec § 5.3", () => {
  assert.deepEqual([H.LIMITES.MOIS_PAR_APPEL, H.LIMITES.LIGNES_PAR_MOIS, H.LIMITES.ORDRES_PAR_APPEL, H.LIMITES.LIGNES_PAR_APPEL, H.LIMITES.MOUVEMENTS_PAR_APPEL, H.LIMITES.RELEVES_VALEUR_PAR_APPEL,
    H.LIMITES.PROPOSITION_OCTETS, H.LIMITES.APPELS_PAR_JOUR, H.LIMITES.COMPTES, H.LIMITES.MOIS_PAR_COMPTE, H.LIMITES.TRANSACTIONS_IMPORTEES, H.LIMITES.IMPORTS],
  [60, 30, 400, 50, 300, 120, 100000, 60, 40, 240, 50000, 300]);
  assert.deepEqual(H.TYPES_MOUVEMENT, ["achat", "vente", "versement", "programme", "retrait", "rachat", "arbitrage_entree", "arbitrage_sortie", "dividende", "interets", "frais", "releve", "solde"]);
});

test("decouper : un contenu qui tient reste entier ; sinon, par année puis par lots, chaque morceau sous la limite", () => {
  const c = cas("B1"), r = verifier(c);
  assert.equal(H.decouper("releves", r.contenu).length, 1);
  // 60 mois de 30 lignes : trop gros pour une proposition de 100 000 octets, découpé par année
  const mois = Array.from({ length: 60 }, (_, i) => {
    const a = 2021 + Math.floor((i + 9) / 12), m = (i + 9) % 12 + 1;
    return { mois: a + "-" + String(m).padStart(2, "0"), complet: true, controle: { total_entrees: 3000, total_sorties: 3000 }, sous_categories: [
      { cle: "revenus", entrees: 3000, sorties: 0, nombre: 1 }, ...H.CATEGORIES_LARGES.filter(k => !["revenus", "virement_interne"].includes(k)).map(k => ({ cle: k, entrees: 0, sorties: 300, nombre: 3 })), { cle: "virement_interne", entrees: 0, sorties: 0, nombre: 0 }] };
  }).map(m => ({ ...m, controle: { total_entrees: 3000, total_sorties: 3000 } }));
  const gros = H.verifier("releves", { ...resoudre(c.entree), mois, fichier: { format: "csv", periode: { du: "2021-10-01", au: "2026-09-30" } } }, { today: "2026-10-16", taxonomie: "large" });
  assert.deepEqual(gros.bloquants, []);
  const morceaux = H.decouper("releves", gros.contenu, 20000);
  assert.ok(morceaux.length > 1);
  assert.equal(morceaux.reduce((a, m) => a + m.mois.length, 0), 60, "aucun mois perdu ni doublé");
  morceaux.forEach(m => assert.ok(new TextEncoder().encode(JSON.stringify(H.versApres("releves", m, { empreinte: "0".repeat(64), today: "2026-10-16" }))).length <= 20000));
  // 400 ordres : par année, puis par 200
  const p400 = cas("P-400"), v = verifier(p400);
  assert.deepEqual(v.bloquants, []);
  const lots = H.decouper("ordres", v.contenu, 30000);
  assert.ok(lots.length > 1);
  assert.equal(lots.reduce((a, m) => a + m.mouvements.length, 0), 400);
  lots.forEach(l => assert.ok(l.mouvements.length <= H.LIMITES.MOUVEMENTS_PAR_LOT));
});

test("chevauchement avec la banque connectée : les mois que Powens couvre déjà sont signalés (le premier mois de la synchronisation, entamé, non)", () => {
  const c = cas("B1"), e = resoudre(c.entree);
  e.compte = { ...e.compte, banque_compte_id: 501 };
  const banque = { mois: [{ mois: "2024-01-01", compteId: 501 }, { mois: "2024-02-01", compteId: 501 }] };
  const r = H.verifier("releves", e, { today: c.today, taxonomie: TAXONOMIE_FIXTURE, banque });
  const w = r.avertissements.find(x => x.cle === "chevauchement_powens");
  assert.deepEqual(w.donnees.mois, ["2024-02"]);
});

test("plafonds et lignes absentes : sans repère, pas de plafond ; un type réservé à la nuit est refusé", () => {
  const c = cas("V-plafond-pea"), e = resoudre(c.entree), ctx = contexteDe(c);
  assert.equal(H.verifier("versements", e, { ...ctx, reperes: [] }).avertissements.filter(w => w.cle.startsWith("plafond")).length, 0);
  e.mouvements[0].type = "programme";
  assert.match(H.verifier("versements", e, ctx).bloquants[0].message, /programme est réservé à la nuit/);
});

test("isinValide : mêmes verdicts que l'utilitaire de test, symboles X- admis", async () => {
  const { isinFictif, isinFictifFaux, isinValide } = await import("./helpers/isin-fictif.mjs");
  for (let n = 1; n <= 200; n++) {
    assert.equal(H.isinValide(isinFictif(n)), true, "valide " + n);
    assert.equal(H.isinValide(isinFictifFaux(n)), false, "faux " + n);
    assert.equal(H.isinValide(isinFictif(n, "XS")), isinValide(isinFictif(n, "XS")));
  }
  assert.equal(H.isinValide("X-BTC"), true);
  assert.equal(H.isinValide("fr9990000013"), false, "la normalisation met en majuscules avant");
  assert.equal(H.isinValide(null), false);
});
