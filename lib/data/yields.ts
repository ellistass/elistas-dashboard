// lib/data/yields.ts — 10-year government bond yields (FRED, OECD monthly) for the forex scale-in read.
//
// Tested 7 Nov 2026 (forex COT grade-A retests, 2018–Oct 2026, fair fills, 2-pip spread):
//   10y yield gap (buy − sell) widening over 3 months = "supporting": +0.52R/trade (n 35), avg furthest
//   move +3.4R; "against": 0.00R (n 46), +1.7R. Same win rate (54%) — yields say how FAR, not whether.
//   Scaling in (2nd position at +1R): supporting +0.74R per add (18 adds, +13.4R); against −0.10R (22).
//   Only from 2022 (2018–21 no difference) — rates must be moving. Start the add at half size.
// Monthly data, published with a lag: the read uses the month two before the signal vs five before.

const FRED: Record<string, string> = {
  EUR: "IRLTLT01DEM156N", GBP: "IRLTLT01GBM156N", JPY: "IRLTLT01JPM156N", CHF: "IRLTLT01CHM156N",
  CAD: "IRLTLT01CAM156N", AUD: "IRLTLT01AUM156N", NZD: "IRLTLT01NZM156N", USD: "IRLTLT01USM156N",
};
export type YieldSeries = Record<string, Map<string, number>>;          // ccy → "YYYY-MM" → %
export interface YieldRead { supporting: boolean; change: number; month: string }

let cache: { at: number; data: YieldSeries } | null = null;
const TTL = 24 * 3600 * 1000;

export async function fetchYields(): Promise<YieldSeries> {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  const data: YieldSeries = {};
  await Promise.all(Object.entries(FRED).map(async ([ccy, id]) => {
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`FRED ${id} ${res.status}`);
    const m = new Map<string, number>();
    for (const line of (await res.text()).trim().split("\n").slice(1)) {
      const [d, v] = line.split(",");
      if (v && v !== "." && Number.isFinite(+v)) m.set(d.slice(0, 7), +v);
    }
    data[ccy] = m;
  }));
  cache = { at: Date.now(), data };
  return data;
}

const monthsBack = (ym: string, n: number) => {
  let [y, m] = ym.split("-").map(Number);
  m -= n;
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
};
/** Latest value at or before `ym` (up to 3 months back — a late print shouldn't blank the read). */
const at = (s: Map<string, number> | undefined, ym: string) => {
  for (let k = 0; k < 4; k++) { const v = s?.get(monthsBack(ym, k)); if (v != null) return v; }
  return null;
};

/** 10y yield gap (buy − sell) change over 3 months, as known at `date`. null = no data. */
export function yieldRead(y: YieldSeries, buy: string, sell: string, date: string): YieldRead | null {
  const now = monthsBack(date.slice(0, 7), 2), then = monthsBack(now, 3);
  const g = (ym: string) => { const a = at(y[buy], ym), b = at(y[sell], ym); return a == null || b == null ? null : a - b; };
  const g1 = g(now), g0 = g(then);
  if (g1 == null || g0 == null) return null;
  const change = +(g1 - g0).toFixed(2);
  return { supporting: change > 0, change, month: now };
}

// US 10-year real yield (TIPS, FRED DFII10, daily) — gold/silver range rule (Nov 2026 test):
// take gold/silver only when real yields moved AGAINST the trade by ≥ 0.10 over 60 sessions.
let realCache: { at: number; data: [string, number][] } | null = null;

export async function fetchRealYield(): Promise<[string, number][]> {
  if (realCache && Date.now() - realCache.at < TTL) return realCache.data;
  const res = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10", { cache: "no-store" });
  if (!res.ok) throw new Error(`FRED DFII10 ${res.status}`);
  const data: [string, number][] = [];
  for (const line of (await res.text()).trim().split("\n").slice(1)) {
    const [d, v] = line.split(",");
    if (v && v !== "." && Number.isFinite(+v)) data.push([d, +v]);
  }
  realCache = { at: Date.now(), data };
  return data;
}
