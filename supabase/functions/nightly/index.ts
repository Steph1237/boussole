// Boussole : fonction nocturne.
//
// Appelée par pg_cron (job `boussole-nightly`, 20:30 UTC) via pg_net, avec
// `Authorization: Bearer <jeton>` où le jeton est lu dans Supabase Vault (`nightly_token`).
// Déployée avec verify_jwt = false : l'authentification est faite ici, par
// public.check_nightly_token() (exécutable par le rôle service uniquement).
//
// Étapes : cours Yahoo → instruments (en EUR) ; take_snapshots() ; apply_recurring() ;
// take_snapshots() (la photo du jour inclut les versements) ; finish_nightly() (status + job_runs).
// Seules variables d'environnement utilisées : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY,
// fournies automatiquement par la plateforme.
import { createClient } from "npm:@supabase/supabase-js@2";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DELAY_MS = 150;
const BUDGET_MS = 100_000;

// Yahoo renvoie souvent 429 aux requêtes sans cookie : en cas de 401/403/429, on ouvre une
// session (cookie A3 via fc.yahoo.com + crumb) une fois, puis on réessaie avec cookie et crumb.
type YahooSession = { cookie: string; crumb: string };
let yahooSession: Promise<YahooSession | null> | null = null;

async function openYahooSession(): Promise<YahooSession | null> {
  try {
    const r1 = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
    const cookie = r1.headers.getSetCookie().map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    await r1.body?.cancel();
    if (!cookie) return null;
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.length > 64 || /\s/.test(crumb)) return null;
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function yahooGet(url: string): Promise<Response> {
  const headers = { "User-Agent": UA, Accept: "application/json" };
  const res = await fetch(url, { headers });
  if (![401, 403, 429].includes(res.status)) return res;
  await res.body?.cancel();
  yahooSession ??= openYahooSession();
  const s = await yahooSession;
  if (!s) {
    yahooSession = null;
    return new Response(null, { status: res.status });
  }
  const sep = url.includes("?") ? "&" : "?";
  const retry = await fetch(`${url}${sep}crumb=${encodeURIComponent(s.crumb)}`, { headers: { ...headers, Cookie: s.cookie } });
  if ([401, 403].includes(retry.status)) yahooSession = null; // crumb expiré : nouvelle session au prochain appel
  return retry;
}

type Quote = { price: number; currency: string; time: number | null };
type RunError = { isin?: string; symbol?: string; error: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Date YYYY-MM-DD à Paris pour un horodatage Unix (secondes). */
function parisDate(unixSeconds: number | null): string {
  const d = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
}

async function fetchQuote(symbol: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await yahooGet(url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error(data?.chart?.error?.description || "réponse vide");
  const meta = r.meta || {};
  let price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
  if (price == null) {
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close || [];
    for (let i = closes.length - 1; i >= 0; i--) {
      if (typeof closes[i] === "number") { price = closes[i] as number; break; }
    }
  }
  if (price == null || !isFinite(price) || price <= 0) throw new Error("cours absent");
  return { price, currency: String(meta.currency || "EUR"), time: meta.regularMarketTime ?? null };
}

/** Taux de change CUR → EUR, mis en cache pendant le passage. */
const fxCache = new Map<string, Promise<number>>();
function fxToEur(cur: string): Promise<number> {
  if (cur === "EUR") return Promise.resolve(1);
  if (!fxCache.has(cur)) fxCache.set(cur, fetchQuote(`${cur}EUR=X`).then((q) => q.price));
  return fxCache.get(cur)!;
}

/** Convertit un cours Yahoo en EUR (GBp/GBX : pence → livres avant conversion). */
async function toEur(q: Quote): Promise<number> {
  let { price, currency } = q;
  if (currency === "GBp" || currency === "GBX") { price = price / 100; currency = "GBP"; }
  currency = currency.toUpperCase();
  if (currency === "EUR") return price;
  try {
    return price * (await fxToEur(currency));
  } catch (e) {
    fxCache.delete(currency);
    throw new Error(`change ${currency}EUR indisponible (${(e as Error).message})`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "méthode non autorisée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "configuration manquante" }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Authentification par jeton (Vault).
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : "";
  if (!token) return json({ ok: false, error: "non autorisé" }, 401);
  const check = await admin.rpc("check_nightly_token", { p: token });
  if (check.error) {
    console.error("nightly: vérification du jeton impossible", check.error.message);
    return json({ ok: false, error: "vérification impossible" }, 500);
  }
  if (check.data !== true) return json({ ok: false, error: "non autorisé" }, 401);

  const started = new Date();
  const t0 = Date.now();
  const errors: RunError[] = [];
  let updated = 0;

  // 2. Cours.
  const { data: instruments, error: instErr } = await admin
    .from("instruments")
    .select("isin, symbol")
    .not("symbol", "is", null)
    .order("isin");
  if (instErr) {
    errors.push({ error: `lecture des instruments : ${instErr.message}` });
  } else {
    for (const ins of instruments || []) {
      const symbol = String(ins.symbol || "").trim();
      if (!symbol) continue;
      if (Date.now() - t0 > BUDGET_MS) {
        errors.push({ isin: ins.isin, symbol, error: "temps dépassé, cours non récupéré" });
        continue;
      }
      try {
        const q = await fetchQuote(symbol);
        const price = await toEur(q);
        const { error } = await admin
          .from("instruments")
          .update({ price: Math.round(price * 1e6) / 1e6, price_date: parisDate(q.time), source: "yahoo" })
          .eq("isin", ins.isin);
        if (error) throw new Error(error.message);
        updated++;
      } catch (e) {
        errors.push({ isin: ins.isin, symbol, error: (e as Error).message });
      }
      await sleep(DELAY_MS);
    }
  }
  console.log(`nightly: ${updated}/${instruments?.length ?? 0} cours mis à jour, ${errors.length} erreur(s)`);

  // 3. Photos, versements, photo finale, compte rendu.
  const step = async (name: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) {
      errors.push({ error: `${name} : ${error.message}` });
      console.error(`nightly: ${name} en échec`, error.message);
      return null;
    }
    return data;
  };

  await step("take_snapshots");
  const recurring = (await step("apply_recurring")) ?? 0;
  const users = (await step("take_snapshots")) ?? 0;
  const fin = await admin.rpc("finish_nightly", {
    p_started: started.toISOString(),
    p_instruments: updated,
    p_errors: errors,
  });
  if (fin.error) {
    console.error("nightly: finish_nightly en échec", fin.error.message);
    errors.push({ error: `finish_nightly : ${fin.error.message}` });
  }

  console.log(`nightly: ${users} utilisateur(s), ${recurring} versement(s), ${Date.now() - t0} ms`);
  return json({ ok: !fin.error, instruments_updated: updated, users, recurring_applied: recurring, errors });
});
