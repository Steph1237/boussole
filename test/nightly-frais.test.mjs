// Frais des fonds (CP4 § 2, docs/superpowers/specs/2026-10-12-cp4-sante-design.md) : fonction pure de
// supabase/functions/nightly/frais.ts (types retirés, contexte vm) qui lit la réponse Yahoo quoteSummary (modules fundProfile et
// defaultKeyStatistics) et rend les frais courants dans l'unité de instruments.ter (% par an : 0,12 = 0,12 %/an).
// Aucun réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";

const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
function charger() {
  const source = readFileSync(new URL("../supabase/functions/nightly/frais.ts", import.meta.url), "utf8");
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { Math, JSON, Number, String, Object, Array, Error, isFinite, parseFloat, RegExp });
}
const qs = (r) => ({ quoteSummary: { result: [r], error: null } });

test("frais Yahoo : annualReportExpenseRatio { raw, fmt } en fraction → % par an (unité de instruments.ter)", { skip: SANS_STRIP }, () => {
  const F = charger();
  assert.equal(F.fraisYahoo(qs({ fundProfile: { feesExpensesInvestment: { annualReportExpenseRatio: { raw: 0.0007, fmt: "0.07%" } } } })), 0.07);
  assert.equal(F.fraisYahoo(qs({ defaultKeyStatistics: { annualReportExpenseRatio: { raw: 0.0038, fmt: "0.38%" } } })), 0.38);
  assert.equal(F.fraisYahoo(qs({ defaultKeyStatistics: { annualReportExpenseRatio: { raw: 0.012 } } })), 1.2, "sans fmt : fraction");
  assert.equal(F.fraisYahoo(qs({ defaultKeyStatistics: { annualReportExpenseRatio: 0.0025 } })), 0.25, "nombre brut (formatted=false)");
  assert.equal(F.fraisYahoo(qs({ fundProfile: { feesExpensesInvestment: { annualReportExpenseRatio: { raw: 0.00075, fmt: "0.08%" } } } })), 0.075,
    "précision du raw gardée (fmt arrondi)");
});

test("frais Yahoo : ordre des champs (fundProfile d'abord), repli sur les frais nets, valeur déjà en % reconnue par fmt", { skip: SANS_STRIP }, () => {
  const F = charger();
  assert.equal(F.fraisYahoo(qs({
    fundProfile: { feesExpensesInvestment: { annualReportExpenseRatio: { raw: 0.002, fmt: "0.20%" } } },
    defaultKeyStatistics: { annualReportExpenseRatio: { raw: 0.003, fmt: "0.30%" } },
  })), 0.2);
  assert.equal(F.fraisYahoo(qs({
    fundProfile: { feesExpensesInvestment: { annualReportExpenseRatio: {}, netExpRatio: { raw: 0.0015, fmt: "0.15%" } } },
    defaultKeyStatistics: { annualReportExpenseRatio: {} },
  })), 0.15, "annualReportExpenseRatio vide → netExpRatio");
  assert.equal(F.fraisYahoo(qs({ defaultKeyStatistics: { netExpenseRatio: { raw: 0.0022, fmt: "0.22%" } } })), 0.22);
  assert.equal(F.fraisYahoo(qs({ fundProfile: { feesExpensesInvestment: { netExpRatio: { raw: 0.59, fmt: "0.59%" } } } })), 0.59,
    "raw déjà en % (fmt identique) : pas de conversion");
});

test("frais Yahoo : absents ou invraisemblables → null (jamais d'écriture)", { skip: SANS_STRIP }, () => {
  const F = charger();
  for (const [data, m] of [
    [null, "rien"], [{}, "objet vide"], [{ quoteSummary: { result: null, error: { code: "Not Found" } } }, "introuvable"],
    [{ quoteSummary: { result: [] } }, "résultat vide"],
    [qs({ defaultKeyStatistics: { sharesOutstanding: { raw: 1e9 } } }), "action : pas de frais"],
    [qs({ defaultKeyStatistics: { annualReportExpenseRatio: {} } }), "objet vide {}"],
    [qs({ defaultKeyStatistics: { annualReportExpenseRatio: { raw: 0, fmt: "0.00%" } } }), "zéro : non renseigné"],
    [qs({ defaultKeyStatistics: { annualReportExpenseRatio: { raw: -0.001 } } }), "négatif"],
    [qs({ defaultKeyStatistics: { annualReportExpenseRatio: { raw: 0.25 } } }), "25 % : invraisemblable (> 10 %)"],
    [qs({ defaultKeyStatistics: { annualReportExpenseRatio: { raw: "0.001" } } }), "texte"],
    [qs({ defaultKeyStatistics: { annualReportExpenseRatio: { raw: NaN } } }), "NaN"],
  ]) assert.equal(F.fraisYahoo(data), null, m);
});

test("frais Yahoo : adresse quoteSummary (query2, modules fundProfile et defaultKeyStatistics, symbole encodé)", { skip: SANS_STRIP }, () => {
  const F = charger();
  assert.equal(F.urlFrais("CW8.PA"),
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/CW8.PA?modules=fundProfile,defaultKeyStatistics");
  assert.equal(F.urlFrais("0P0000X^Y"),
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/0P0000X%5EY?modules=fundProfile,defaultKeyStatistics");
});
