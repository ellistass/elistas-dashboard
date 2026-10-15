// lib/data/eps.ts — quarterly EPS from Yahoo, stored so the history builds up.
import { db } from "@/lib/db";
import type { EpsReport } from "@/lib/setups/valuation";

export const ETF = new Set(["SPY", "QQQ", "IWM", "DIA", "XLE", "XLF", "XLK", "GLD", "SLV"]);
const REPORT_LAG_DAYS = 45;          // EPS is only known ~6 weeks after the quarter ends
const REFRESH_MS = 24 * 3600 * 1000; // ask Yahoo at most once a day per stock

async function fetchYahooEps(symbol: string): Promise<{ asOf: string; eps: number }[]> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 6 * 365 * 86400;
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=quarterlyDilutedEPS&period1=${p1}&period2=${p2}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }, cache: "no-store" });
  if (!r.ok) throw new Error(`yahoo eps ${r.status}`);
  const j = await r.json();
  const rows: any[] = j?.timeseries?.result?.[0]?.quarterlyDilutedEPS ?? [];
  return rows.filter(Boolean)
    .map((x) => ({ asOf: String(x.asOfDate), eps: Number(x.reportedValue?.raw) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.asOf) && Number.isFinite(x.eps));
}

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/** Stored quarters for a stock, refreshed from Yahoo when stale. A Yahoo failure
 *  never breaks the scan — it just uses what is stored. `force` = the afternoon cron. */
export async function epsFor(symbol: string, force = false): Promise<EpsReport[]> {
  if (ETF.has(symbol)) return [];
  const stored = await db.epsQuarter.findMany({ where: { symbol }, orderBy: { asOf: "asc" } });
  const fresh = stored.length > 0 && Date.now() - Math.max(...stored.map((s) => s.updatedAt.getTime())) < REFRESH_MS;
  if (force || !fresh) {
    try {
      for (const q of await fetchYahooEps(symbol))
        await db.epsQuarter.upsert({ where: { symbol_asOf: { symbol, asOf: q.asOf } }, create: { symbol, ...q }, update: { eps: q.eps } });
    } catch { /* keep the stored history */ }
  }
  const all = await db.epsQuarter.findMany({ where: { symbol }, orderBy: { asOf: "asc" } });
  return all.map((q) => ({ date: addDays(q.asOf, REPORT_LAG_DAYS), eps: q.eps }));
}
