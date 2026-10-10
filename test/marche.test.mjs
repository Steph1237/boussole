import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Marche = require("../web/src/marche.js");
const Calc = require("../web/src/calc.js");

const CHAMPS = ["label", "rendementLong", "volatilite", "pireBaisse", "episodePireBaisse", "pireAnnee", "anneePire", "source"];
const ATTENDUES = ["actions", "obligations", "immobilier", "monetaire", "fonds_euros", "or", "crypto", "autres", "levier", "small_caps", "emergents"];

describe("statistiques par classe", () => {
  test("toutes les classes attendues, y compris celles de Calc et les cas particuliers", () => {
    assert.deepEqual([...Marche.CLES].sort(), [...ATTENDUES].sort());
    assert.deepEqual(Object.keys(Marche.CLASSES).sort(), [...ATTENDUES].sort());
    Object.keys(Calc.CLASSES_LABELS).forEach(k => assert.ok(Marche.CLASSES[k], "classe Calc absente : " + k));
  });
  test("chaque classe a tous les champs, des nombres cohérents et une source non vide", () => {
    for (const k of Marche.CLES) {
      const c = Marche.CLASSES[k];
      CHAMPS.forEach(f => assert.ok(f in c, k + " sans " + f));
      assert.ok(typeof c.label === "string" && c.label.length > 0, k + " label");
      assert.ok(typeof c.source === "string" && c.source.trim().length > 10, k + " source");
      assert.ok(typeof c.episodePireBaisse === "string" && c.episodePireBaisse.length > 0, k + " épisode");
      ["rendementLong", "volatilite", "pireBaisse", "pireAnnee"].forEach(f => assert.ok(Number.isFinite(c[f]), k + "." + f));
      assert.ok(c.volatilite >= 0, k + " volatilité ≥ 0");
      assert.ok(c.pireBaisse <= 0 && c.pireBaisse >= -100, k + " pire baisse dans [−100, 0]");
      assert.ok(c.pireAnnee <= 0 && c.pireAnnee >= c.pireBaisse, k + " pire année entre la pire baisse et 0");
    }
  });
  test("valeurs de référence (spec §2)", () => {
    const C = Marche.CLASSES;
    assert.equal(C.actions.volatilite, 15); assert.equal(C.actions.pireBaisse, -55);
    assert.equal(C.levier.volatilite, 45); assert.equal(C.levier.pireBaisse, -85);
    assert.equal(C.obligations.volatilite, 5); assert.equal(C.obligations.pireBaisse, -17); assert.equal(C.obligations.anneePire, 2022);
    assert.equal(C.fonds_euros.pireBaisse, 0); assert.equal(C.monetaire.pireBaisse, 0);
    assert.equal(C.immobilier.pireBaisse, -20); assert.equal(C.or.pireBaisse, -45);
    assert.equal(C.crypto.volatilite, 70); assert.equal(C.crypto.pireBaisse, -80);
  });
});

describe("corrélations", () => {
  const K = () => Marche.CLES;
  test("matrice complète, symétrique, diagonale unitaire, dans [−1, 1]", () => {
    for (const a of K()) for (const b of K()) {
      const v = Marche.correlation(a, b);
      assert.ok(Number.isFinite(v), a + "/" + b);
      assert.ok(v >= -1 && v <= 1, a + "/" + b + " hors [−1, 1]");
      assert.equal(v, Marche.correlation(b, a), a + "/" + b + " non symétrique");
      if (a === b) assert.equal(v, 1);
      assert.equal(Marche.CORRELATIONS[a][b], v);
    }
  });
  test("simplifications documentées", () => {
    const c = Marche.correlation;
    for (const [a, b] of [["actions", "levier"], ["actions", "small_caps"], ["actions", "emergents"], ["levier", "small_caps"], ["small_caps", "emergents"]])
      assert.ok(c(a, b) >= 0.8 && c(a, b) <= 0.95, a + "/" + b);
    assert.equal(c("actions", "obligations"), 0.1);
    assert.equal(c("actions", "or"), 0.1);
    assert.equal(c("actions", "crypto"), 0.4);
    assert.equal(c("actions", "immobilier"), 0.5);
    for (const k of Marche.CLES) if (k !== "monetaire") assert.equal(c("monetaire", k), 0);
    for (const k of Marche.CLES) if (k !== "fonds_euros") assert.equal(c("fonds_euros", k), 0);
  });
  test("semi-définie positive (Cholesky aboutit) : toute variance de portefeuille est ≥ 0", () => {
    const k = Marche.CLES, n = k.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = Marche.correlation(k[i], k[j]);
      for (let m = 0; m < j; m++) s -= L[i][m] * L[j][m];
      if (i === j) { assert.ok(s > -1e-12, "pivot négatif en " + k[i]); L[i][i] = Math.sqrt(Math.max(s, 0)); }
      else L[i][j] = L[j][j] > 0 ? s / L[j][j] : 0;
    }
  });
});

describe("classeRisque", () => {
  const p = (bloc, name) => ({ owner: "p1", bloc, name, mode: "manual", value: 1000, status: "actif" });
  test("levier détecté sur la poche ou le nom", () => {
    assert.equal(Marche.classeRisque(p("Nasdaq 2x", "Amundi Nasdaq-100")), "levier");
    assert.equal(Marche.classeRisque(p("Monde", "Amundi Nasdaq-100 Daily 2x Leveraged")), "levier");
    assert.equal(Marche.classeRisque(p("Convictions", "ETF à effet de levier x2 CAC 40")), "levier");
    assert.equal(Marche.classeRisque(p("Leveraged", "")), "levier");
  });
  test("pas de faux positif de levier", () => {
    assert.equal(Marche.classeRisque(p("Monde", "ETF MSCI World")), "actions");
    assert.equal(Marche.classeRisque(p("Monde", "Amundi PEA S&P 500 ESG")), "actions");
    assert.equal(Marche.classeRisque(p("Épargne", "Livret A")), "monetaire");
  });
  test("sinon la classe de Calc, affinée en small caps et émergents pour les actions", () => {
    assert.equal(Marche.classeRisque(p("SCPI", "SCPI diversifiée")), "immobilier");
    assert.equal(Marche.classeRisque(p("Protection", "Fonds en euros")), "fonds_euros");
    assert.equal(Marche.classeRisque(p("Monde", "iShares MSCI Emerging Markets")), "emergents");
    assert.equal(Marche.classeRisque(p("Émergents", "")), "emergents");
    assert.equal(Marche.classeRisque(p("Europe", "Amundi MSCI Europe Small Cap")), "small_caps");
    assert.equal(Marche.classeRisque(p("Obligations", "Emerging Markets Bond")), "obligations");
    assert.equal(Marche.classeRisque(p("Poche inconnue", "")), "autres");
  });
  test("la surcharge poche → classe est respectée (le levier inscrit dans le nom reste prioritaire)", () => {
    assert.equal(Marche.classeRisque(p("Protection", "Lingot"), { Protection: "or" }), "or");
    assert.equal(Marche.classeRisque(p("Nasdaq 2x", "Amundi Nasdaq-100"), { "Nasdaq 2x": "actions" }), "actions");
    assert.equal(Marche.classeRisque(p("Monde", "Amundi Nasdaq-100 Daily 2x Leveraged"), { Monde: "actions" }), "levier");
  });
});

describe("crises de référence", () => {
  const IDS = ["dotcom_2000", "gfc_2008", "covid_2020", "taux_2022", "inflation_1973"];
  test("cinq crises datées, décrites et sourcées", () => {
    assert.deepEqual(Object.keys(Marche.CRISES).sort(), [...IDS].sort());
    for (const id of IDS) {
      const c = Marche.CRISES[id];
      assert.match(c.debut, /^\d{4}-\d{2}$/); assert.match(c.fin, /^\d{4}-\d{2}$/);
      assert.ok(c.debut < c.fin, id + " dates");
      assert.ok(c.label && c.description && c.source, id + " textes");
    }
  });
  test("un choc chiffré pour chaque classe, et des substituts signalés", () => {
    for (const id of IDS) {
      const c = Marche.CRISES[id];
      for (const k of Marche.CLES) assert.ok(Number.isFinite(c.chocs[k]) && c.chocs[k] >= -100, id + " sans choc " + k);
      Object.keys(c.proxy || {}).forEach(k => assert.ok(Marche.CLES.includes(k)));
    }
    assert.equal(Marche.CRISES.gfc_2008.chocs.actions, -55);
    assert.equal(Marche.CRISES.gfc_2008.chocs.levier, -85);
    assert.equal(Marche.CRISES.gfc_2008.chocs.crypto, -70);
    assert.equal(Marche.CRISES.gfc_2008.proxy.crypto, true);
    assert.equal(Marche.CRISES.taux_2022.chocs.obligations, -17);
    assert.ok(!(Marche.CRISES.taux_2022.proxy || {}).crypto, "la crypto existait en 2022");
  });
});
