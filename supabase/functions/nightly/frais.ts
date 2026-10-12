// Boussole : frais des fonds (spec CP4 § 2, docs/superpowers/specs/2026-10-12-cp4-sante-design.md), fonctions pures.
//
// Yahoo quoteSummary (cookie de session et crumb exigés, ouverts par index.ts) :
//   GET https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbole}?modules=fundProfile,defaultKeyStatistics&crumb=…
//   → { quoteSummary: { result: [{
//         fundProfile: { feesExpensesInvestment: { annualReportExpenseRatio: { raw: 0.0007, fmt: "0.07%" }, netExpRatio: {…}, … } },
//         defaultKeyStatistics: { annualReportExpenseRatio: { raw: 0.0007, fmt: "0.07%" } | {}, … } }], error: null } }
//   Symbole inconnu : HTTP 404, { quoteSummary: { result: null, error: { code: "Not Found", … } } }.
//   Une action n'a pas de fundProfile ni de frais : « non publiés » (nouvel essai dans 30 jours).
// Le raw est une fraction (0.0007 = 0,07 %/an) ; instruments.ter est en % par an (0,07 = 0,07 %/an) : × 100. Quand le fmt
// (« 0.07% ») montre que le raw est déjà en %, il est gardé tel quel. Zéro, négatif ou plus de 10 % (plafond de instruments.ter) :
// valeur écartée.

const BASE = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/";

/** Adresse quoteSummary d'un symbole Yahoo (le crumb est ajouté par l'appelant). */
export function urlFrais(symbol: string): string {
  return `${BASE}${encodeURIComponent(symbol)}?modules=fundProfile,defaultKeyStatistics`;
}

/** Valeur Yahoo { raw, fmt } (ou nombre brut) → % par an, ou null si absente ou invraisemblable. */
function pourcent(v: any): number | null {
  const raw = typeof v === "number" ? v : v && typeof v === "object" ? v.raw : undefined;
  if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return null;
  let pct = raw * 100;
  const fmt = v && typeof v === "object" && typeof v.fmt === "string" ? v.fmt.trim() : "";
  const m = fmt.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (m) {
    const f = parseFloat(m[1].replace(",", "."));
    if (Math.abs(f - raw) < Math.abs(f - pct)) pct = raw; // fmt « 0.59% » pour raw 0.59 : déjà en %
  }
  pct = Math.round(pct * 1e4) / 1e4;
  return pct > 0 && pct <= 10 ? pct : null;
}

/** Frais courants (% par an, unité de instruments.ter) lus dans une réponse quoteSummary ; null s'ils ne sont pas publiés. */
export function fraisYahoo(data: any): number | null {
  const r = data?.quoteSummary?.result?.[0];
  if (!r || typeof r !== "object") return null;
  const fp = r.fundProfile?.feesExpensesInvestment, ks = r.defaultKeyStatistics;
  for (const v of [fp?.annualReportExpenseRatio, ks?.annualReportExpenseRatio, fp?.netExpRatio, ks?.netExpenseRatio]) {
    const p = pourcent(v);
    if (p != null) return p;
  }
  return null;
}
