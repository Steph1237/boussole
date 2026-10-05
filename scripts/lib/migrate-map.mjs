// Conversion des données de l'artefact « Pilotage patrimoine » (vocabulaire steph/compagne/couple)
// vers le schéma Boussole (p1/p2/foyer). Fonctions pures : aucune lecture ni écriture ici.
import { randomUUID } from "node:crypto";

const OWNER = { steph: "p1", compagne: "p2" };
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/* Identifiant d'instrument : l'ISIN, ou « X-<TICKER>-EUR » pour une ligne cotée sans ISIN (crypto). */
export function instrumentKey(p) {
  if (p.isin && ISIN.test(p.isin)) return p.isin;
  if (p.mode === "market" && p.ticker) return `X-${String(p.ticker).toUpperCase()}-EUR`;
  return null;
}

/* Symbole Yahoo deviné quand la recherche n'aboutit pas. */
export function guessSymbol(p) {
  if (!p.ticker) return null;
  const t = String(p.ticker).toUpperCase();
  if (p.envelope && /crypto/i.test(p.envelope)) return `${t}-EUR`;
  if (p.isin && p.isin.startsWith("NL")) return `${t}.AS`;
  if (p.isin && p.isin.startsWith("DE")) return `${t}.DE`;
  return `${t}.PA`;
}

export function mapInstruments(positions, symbols = {}) {
  const out = new Map();
  for (const p of positions) {
    const isin = instrumentKey(p);
    if (!isin) continue;
    const cur = out.get(isin);
    const row = { isin, symbol: symbols[isin] ?? guessSymbol(p), name: p.name, currency: "EUR", price: p.price ?? null, price_date: p.priceDate ?? null, source: "migration" };
    // Plusieurs lignes peuvent partager un ISIN (or physique dans deux contrats) : on garde le cours le plus récent.
    if (!cur || (row.price_date || "") > (cur.price_date || "")) out.set(isin, Object.assign({}, cur || {}, row, { symbol: row.symbol || (cur && cur.symbol) || null }));
  }
  return [...out.values()];
}

export function mapPositions(positions, userId, uuid = randomUUID) {
  const ids = {};
  const rows = positions.map(p => {
    const id = uuid();
    ids[p.id] = id;
    const market = p.mode === "market";
    return {
      id, user_id: userId, name: p.name, envelope: p.envelope || "", owner: OWNER[p.owner] || "p1", bloc: p.bloc || "",
      mode: market ? "market" : "manual", isin: instrumentKey(p),
      qty: market ? p.qty ?? null : null, pru: market ? p.pru ?? null : null,
      value: market ? null : p.value ?? null, value_date: market ? null : p.valueDate ?? null,
      status: p.status || "actif", hypothesis: p.hypothesis || null, qty_estimated: !!p.qtyEstimated, note: p.note || null,
    };
  });
  return { rows, ids };
}

export function mapTransactions(tx, ids, userId) {
  return tx.filter(t => ids[t.positionId]).map(t => ({
    user_id: userId, position_id: ids[t.positionId], date: t.date, type: t.type,
    qty: t.qty ?? null, price: t.price ?? null, amount: t.amount ?? null,
    note: t.note || t.label || null, source: "migration",
  }));
}

const byOwner = o => o ? { p1: o.steph || {}, p2: o.compagne || {} } : {};
export function mapSnapshots(snaps, userId) {
  return snaps.map(s => ({
    user_id: userId, date: s.date,
    total: s.couple ?? null, p1: s.steph ?? null, p2: s.compagne ?? null,
    by_bloc: byOwner(s.byBloc), by_envelope: s.byEnvelope || {}, source: s.source === "relevés" ? "releves" : "migration",
  }));
}

/* Les alertes codées en dur de l'artefact deviennent des règles paramétrables. */
export function mapRules(alerts = {}, positions = [], ids = {}) {
  const rules = [];
  const lqq = positions.find(p => p.bloc === "Nasdaq 2x" && p.mode === "market");
  if (alerts.stopNasdaq && lqq && ids[lqq.id]) rules.push({ type: "price_floor", position_id: ids[lqq.id], price: alerts.stopNasdaq });
  if (alerts.maxNasdaqPct) rules.push({ type: "max_bloc_pct", bloc: "Nasdaq 2x", pct: alerts.maxNasdaqPct });
  if (alerts.maxCryptoPct) rules.push({ type: "max_bloc_pct", bloc: "Crypto", pct: alerts.maxCryptoPct });
  if (alerts.livretCap) rules.push({ type: "envelope_cap", envelope: "Livrets", cap: alerts.livretCap });
  rules.push({ type: "stale_prices", days: 4 });
  return rules;
}

export function mapConfig(cfg, positions, ids, userId) {
  const c = cfg || {};
  const t = c.targets || {};
  return {
    user_id: userId,
    targets: { p1: t.steph || {}, p2: t.compagne || {}, tolerancePts: t.tolerancePts ?? 3 },
    rules: mapRules(c.alerts, positions, ids),
    cushion: { mode: "amount", min: c.cushion?.min ?? 0, max: c.cushion?.max ?? 0 },
    recurring: (c.recurring || []).map(r => Object.assign({}, r, { positionId: ids[r.positionId] || null })),
    todo: c.todo || [], milestones: c.milestones || [], hypotheses: c.hypotheses || [],
  };
}

export function mapProfile(profil, userId) {
  const p = profil || {};
  const ps = p.personnes || {};
  return {
    user_id: userId,
    foyer: Object.assign({ adultes: 2 }, p.foyer || {}),
    personnes: { p1: Object.assign({ nom: "Stéph" }, ps.steph || {}), p2: Object.assign({ nom: "Conjoint(e)" }, ps.compagne || {}) },
    autres: { p1: (p.autres || {}).steph || {}, p2: (p.autres || {}).compagne || {} },
    onboarding_done: true,
  };
}
