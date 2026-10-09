// Boussole : fonction nocturne.
//
// Appelée par pg_cron (job `boussole-nightly`, 20:30 UTC) via pg_net, avec
// `Authorization: Bearer <jeton>` où le jeton est lu dans Supabase Vault (`nightly_token`).
// Déployée avec verify_jwt = false : l'authentification est faite ici, par
// public.check_nightly_token() (exécutable par le rôle service uniquement).
//
// Étapes : cours Yahoo, repli Euronext → instruments (en EUR, source yahoo | euronext) ;
// take_snapshots() ; apply_recurring() ; take_snapshots() (la photo du jour inclut les versements) ;
// finish_nightly() (status + job_runs).
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

// Repli Euronext, quand Yahoo échoue (429, symbole invalide…) ou quand l'instrument n'a pas de
// symbole Yahoo. Deux appels publics, sans clé ni cookie (sondés le 2026-10-09) :
//
// 1. Recherche du marché (MIC), mise en cache pendant le passage :
//    GET https://live.euronext.com/en/instrumentSearch/searchJSON?q={ISIN}
//    → [{"value":"FR0010342592","isin":"FR0010342592","mic":"XPAR","label":"<span…>","link":"/en/product/etfs/FR0010342592-XPAR","name":"Amundi NSDQ LEV"},
//       {"isin":"FR0010342592","mic":"ETFP",…}, {"value":"","isin":"","mic":"",…"See all results"}]
//    On garde la première MIC de MIC_PREF présente (marchés au comptant, cotations en EUR).
//
// 2. Historique des cours en CSV, sur les 14 derniers jours :
//    GET https://live.euronext.com/en/ajax/AwlHistoricalPrice/getFullDownloadAjax/{ISIN}-{MIC}
//        ?format=csv&decimal_separator=.&date_form=d/m/Y&startdate=YYYY-MM-DD&enddate=YYYY-MM-DD
//    → (BOM)"Historical Data"
//      "From 2026-09-25 to 2026-10-09"
//      FR0010342592
//      Date;Open;High;Low;Last;Close;"Number of Shares";"Number of Trades";Turnover[;vwap]
//      09/10/2026;10.766;10.812;10.65;10.682;10.682;469092;711;5030484;10.7239
//      … (du plus récent au plus ancien)
//    On prend la ligne la plus récente : colonne Close (à défaut Last), date JJ/MM/AAAA.
//
// Écartés : getDetailedQuote et intraday_chart/getChartData renvoient un JSON chiffré
// ({ct, iv, s}) ; la même URL CSV en POST répond « No format specified ».
// Le CSV ne donne pas la devise : le repli n'est tenté que pour les instruments en EUR.
const EURONEXT = "https://live.euronext.com/en";
const MIC_PREF = ["XPAR", "XAMS", "XBRU", "XLIS", "XMIL", "ETFP"];
const EURONEXT_TIMEOUT_MS = 15_000;
const REAL_ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

type FallbackQuote = { price: number; date: string; mic: string };

const micCache = new Map<string, Promise<string>>();
function euronextMic(isin: string): Promise<string> {
  if (!micCache.has(isin)) {
    const p = (async () => {
      const res = await fetch(`${EURONEXT}/instrumentSearch/searchJSON?q=${encodeURIComponent(isin)}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(EURONEXT_TIMEOUT_MS),
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`recherche HTTP ${res.status}`);
      }
      const list = await res.json();
      const mics = new Set((Array.isArray(list) ? list : []).filter((x) => x?.isin === isin).map((x) => String(x.mic)));
      const mic = MIC_PREF.find((m) => mics.has(m));
      if (!mic) throw new Error("non coté sur Euronext");
      return mic;
    })();
    p.catch(() => micCache.delete(isin));
    micCache.set(isin, p);
  }
  return micCache.get(isin)!;
}

async function fetchEuronext(isin: string): Promise<FallbackQuote> {
  const mic = await euronextMic(isin);
  const end = parisDate(null);
  const start = parisDate(Math.floor((Date.now() - 14 * 86_400_000) / 1000));
  const qs = `format=csv&decimal_separator=.&date_form=d/m/Y&startdate=${start}&enddate=${end}`;
  const res = await fetch(`${EURONEXT}/ajax/AwlHistoricalPrice/getFullDownloadAjax/${isin}-${mic}?${qs}`, {
    headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(EURONEXT_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const lines = (await res.text()).split(/\r?\n/);
  const header = lines.find((l) => l.startsWith("Date;"))?.split(";") ?? [];
  const iClose = header.indexOf("Close");
  const iLast = header.indexOf("Last");
  if (iClose < 0 && iLast < 0) throw new Error("CSV inattendu");
  let best: FallbackQuote | null = null;
  for (const line of lines) {
    const m = line.match(/^(\d{2})\/(\d{2})\/(\d{4});/);
    if (!m) continue;
    const cols = line.split(";");
    const close = parseFloat(cols[iClose]);
    const price = isFinite(close) && close > 0 ? close : parseFloat(cols[iLast]);
    if (!isFinite(price) || price <= 0) continue;
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    if (!best || date > best.date) best = { price, date, mic };
  }
  if (!best) throw new Error("cours absent");
  return best;
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

  // 2. Cours : Yahoo d'abord ; en cas d'échec (ou sans symbole Yahoo), repli Euronext pour les
  // instruments en EUR identifiés par un vrai ISIN (les ISIN de test `X-…` sont ignorés).
  const { data: instruments, error: instErr } = await admin
    .from("instruments")
    .select("isin, symbol, currency")
    .order("isin");
  if (instErr) {
    errors.push({ error: `lecture des instruments : ${instErr.message}` });
  } else {
    for (const ins of instruments || []) {
      const isin = String(ins.isin);
      const symbol = String(ins.symbol || "").trim();
      const canFallback = REAL_ISIN.test(isin) && String(ins.currency || "EUR").toUpperCase() === "EUR";
      if (!symbol && !canFallback) continue;
      if (Date.now() - t0 > BUDGET_MS) {
        errors.push({ isin, symbol: symbol || undefined, error: "temps dépassé, cours non récupéré" });
        continue;
      }
      let row: { price: number; price_date: string; source: string } | null = null;
      let yahooErr = "sans symbole";
      if (symbol) {
        try {
          const q = await fetchQuote(symbol);
          row = { price: await toEur(q), price_date: parisDate(q.time), source: "yahoo" };
        } catch (e) {
          yahooErr = (e as Error).message;
        }
      }
      if (!row && canFallback && Date.now() - t0 <= BUDGET_MS) {
        if (symbol) await sleep(DELAY_MS);
        try {
          const f = await fetchEuronext(isin);
          row = { price: f.price, price_date: f.date, source: "euronext" };
          console.log(`nightly: ${isin} via Euronext ${f.mic} (yahoo : ${yahooErr})`);
        } catch (e) {
          errors.push({ isin, symbol: symbol || undefined, error: `yahoo: ${yahooErr} ; euronext: ${(e as Error).message}` });
        }
      } else if (!row) {
        errors.push({ isin, symbol: symbol || undefined, error: canFallback ? `yahoo: ${yahooErr} ; euronext: temps dépassé` : yahooErr });
      }
      if (row) {
        const { error } = await admin
          .from("instruments")
          .update({ ...row, price: Math.round(row.price * 1e6) / 1e6 })
          .eq("isin", isin);
        if (error) errors.push({ isin, symbol: symbol || undefined, error: `mise à jour : ${error.message}` });
        else updated++;
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
