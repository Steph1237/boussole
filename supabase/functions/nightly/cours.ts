// Boussole : cours historiques (CP1, docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 4).
// Fonctions pures, sans réseau : lecture d'une réponse Yahoo chart et d'un CSV historique Euronext en séries de clôtures
// datées (date de Paris), conversion en EUR (taux du jour, ou série de taux pour un historique), lignes de la table cours
// et découpage en paquets pour l'upsert. Testées par test/nightly-cours.test.mjs.

export type Point = { date: string; close: number };
export type LigneCours = { isin: string; date: string; cloture: number; source: string };

/** Date YYYY-MM-DD à Paris pour un horodatage Unix (secondes) ; maintenant si absent. */
export function parisDate(unixSeconds: number | null | undefined, maintenant: Date = new Date()): string {
  const d = unixSeconds ? new Date(unixSeconds * 1000) : maintenant;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
}

/** Arrondi à 6 décimales (précision gardée en base pour les cours). */
export const arrondi6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Série de clôtures d'une réponse Yahoo v8/finance/chart : points valides (> 0), un par date de Paris (le dernier l'emporte),
 *  triés par date ; devise et dernier cours (meta) à part. */
export function serieYahoo(data: any): { currency: string; points: Point[]; price: number | null; time: number | null } {
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error(data?.chart?.error?.description || "réponse vide");
  const meta = r.meta || {};
  const ts: unknown[] = Array.isArray(r.timestamp) ? r.timestamp : [];
  const closes: unknown[] = r.indicators?.quote?.[0]?.close || [];
  const parDate = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i], c = closes[i];
    if (typeof t !== "number" || typeof c !== "number" || !isFinite(c) || c <= 0) continue;
    parDate.set(parisDate(t), c);
  }
  const points = [...parDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, close]) => ({ date, close }));
  const price = typeof meta.regularMarketPrice === "number" && isFinite(meta.regularMarketPrice) && meta.regularMarketPrice > 0
    ? meta.regularMarketPrice : null;
  return { currency: String(meta.currency || "EUR"), points, price, time: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime : null };
}

/** Clôtures d'un CSV historique Euronext (getFullDownloadAjax, format=csv, date_form=d/m/Y) : colonne Close, à défaut Last ;
 *  triées par date croissante. */
export function serieEuronext(csv: string): Point[] {
  const lines = String(csv).replace(/^﻿/, "").split(/\r?\n/);
  const header = lines.find((l) => l.startsWith("Date;"))?.split(";").map((h) => h.replace(/"/g, "").trim()) ?? [];
  const iClose = header.indexOf("Close");
  const iLast = header.indexOf("Last");
  if (iClose < 0 && iLast < 0) throw new Error("CSV inattendu");
  const parDate = new Map<string, number>();
  for (const line of lines) {
    const m = line.match(/^(\d{2})\/(\d{2})\/(\d{4});/);
    if (!m) continue;
    const cols = line.split(";");
    const close = iClose >= 0 ? parseFloat(cols[iClose]) : NaN;
    const price = isFinite(close) && close > 0 ? close : parseFloat(cols[iLast]);
    if (!isFinite(price) || price <= 0) continue;
    parDate.set(`${m[3]}-${m[2]}-${m[1]}`, price);
  }
  return [...parDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, close]) => ({ date, close }));
}

/** Devise Yahoo normalisée : GBp / GBX (pence) → GBP avec un facteur 1/100. */
export function devise(currency: string): { cur: string; facteur: number } {
  if (currency === "GBp" || currency === "GBX") return { cur: "GBP", facteur: 0.01 };
  return { cur: String(currency || "EUR").toUpperCase(), facteur: 1 };
}

/** Convertit une série avec un taux unique (taux du jour). */
export function convertir(points: Point[], taux: number): Point[] {
  return points.map((p) => ({ date: p.date, close: p.close * taux }));
}

/** Convertit une série avec une série de taux : pour chaque date, dernier taux connu à cette date ou avant (à défaut le premier
 *  taux de la série, à défaut `tauxDuJour`). */
export function convertirAvecSerie(points: Point[], taux: Point[], tauxDuJour: number): Point[] {
  const t = [...taux].sort((a, b) => (a.date < b.date ? -1 : 1));
  let j = -1;
  return [...points].sort((a, b) => (a.date < b.date ? -1 : 1)).map((p) => {
    while (j + 1 < t.length && t[j + 1].date <= p.date) j++;
    const r = j >= 0 ? t[j].close : t.length ? t[0].close : tauxDuJour;
    return { date: p.date, close: p.close * r };
  });
}

/** Lignes de la table cours (clôtures arrondies, > 0). */
export function lignesCours(isin: string, points: Point[], source: string): LigneCours[] {
  return points
    .map((p) => ({ isin, date: p.date, cloture: arrondi6(p.close), source }))
    .filter((l) => isFinite(l.cloture) && l.cloture > 0 && /^\d{4}-\d{2}-\d{2}$/.test(l.date));
}

/** Paquets de `n` éléments au plus. */
export function paquets<T>(liste: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < liste.length; i += n) out.push(liste.slice(i, i + n));
  return out;
}

/** Date YYYY-MM-DD décalée de `jours` (calendrier, UTC). */
export function decalerDate(date: string, jours: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
