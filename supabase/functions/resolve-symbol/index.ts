// Boussole : résolution d'un ISIN en symbole Yahoo.
//
// POST {isin} → 200 {symbol, name, exchange, currency?} | 404 {error:"introuvable"}
//             | 502 {error:"source indisponible"}.
// Déployée avec verify_jwt = true (utilisateur connecté requis). CORS limité à
// https://steph1237.github.io et http://localhost:<port>.
// Les places en euros (Paris, Amsterdam, Xetra/Francfort, Milan) sont préférées.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const EUR_EXCHANGES = ["PAR", "AMS", "GER", "FRA", "MIL"];

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

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin === "https://steph1237.github.io") return origin;
  if (/^http:\/\/localhost(:\d{1,5})?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get("Origin"));
  const h: Record<string, string> = { Vary: "Origin" };
  if (origin) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "méthode non autorisée" }, 405);

  let isin = "";
  try {
    const body = await req.json();
    isin = String(body?.isin ?? "").trim().toUpperCase();
  } catch {
    return json({ error: "corps JSON attendu" }, 400);
  }
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return json({ error: "ISIN invalide" }, 400);

  let quotes: Record<string, unknown>[] = [];
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=5&newsCount=0`;
    const res = await yahooGet(url);
    if (!res.ok) {
      await res.body?.cancel();
      console.error(`resolve-symbol: Yahoo HTTP ${res.status}`);
      return json({ error: "source indisponible" }, 502);
    }
    const data = await res.json();
    quotes = Array.isArray(data?.quotes) ? data.quotes.filter((q: Record<string, unknown>) => q && q.symbol) : [];
  } catch (e) {
    console.error("resolve-symbol: Yahoo injoignable", (e as Error).message);
    return json({ error: "source indisponible" }, 502);
  }

  if (!quotes.length) return json({ error: "introuvable" }, 404);

  const rank = (q: Record<string, unknown>) => {
    const i = EUR_EXCHANGES.indexOf(String(q.exchange || ""));
    return i === -1 ? EUR_EXCHANGES.length : i;
  };
  const best = quotes.reduce((a, b) => (rank(b) < rank(a) ? b : a), quotes[0]);

  const out: Record<string, unknown> = {
    symbol: best.symbol,
    name: best.longname || best.shortname || null,
    exchange: best.exchange || null,
  };
  if (best.currency) out.currency = best.currency;
  else if (EUR_EXCHANGES.includes(String(best.exchange || ""))) out.currency = "EUR";
  return json(out);
});
