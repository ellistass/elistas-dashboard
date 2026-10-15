// lib/setups/valuation.ts — is a stock cheap or expensive vs its OWN last 2 years?
//
// Backtest (stock setups 2021–26, adjusted EPS): conservative retests buying an
// expensive stock won 17% (−0.71R); skipping "valuation against" added +12R.
// Aggressive (spring) stock trades: skipping "against" cut losers but cost −7.8R
// (one AMD +13R winner) — so it is a warning there, not a grade change.
// Live data is Yahoo GAAP diluted EPS, so cut-offs land a little differently.
import type { Bar } from "@/lib/wyckoff/engine";

export interface EpsReport { date: string; eps: number }   // date = when the EPS was known
export type Valuation = "cheap" | "middle" | "expensive" | "loss-making" | "no data";
export interface ValRead { val: Valuation; pe: number | null; pct: number | null; vsTrade: "aligned" | "neutral" | "against" | null }

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Trailing-12-month EPS on a day: last 4 reports, oldest within 400 days. */
function ttm(reports: EpsReport[], day: string): number | null {
  const q = reports.filter((r) => r.date < day).slice(-4);
  if (q.length < 4 || days(q[0].date, day) > 400) return null;
  return q.reduce((s, r) => s + r.eps, 0);
}

/** Today's P/E vs the stock's own P/E over the prior 2 years (weekly samples). */
export function valuationRead(bars: Bar[], reports: EpsReport[], side: "long" | "short"): ValRead {
  const peAt = (i: number) => { const e = ttm(reports, bars[i].date); return e && e > 0 ? bars[i].c / e : null; };
  const i = bars.length - 1, now = peAt(i);
  if (now == null) {
    const e = ttm(reports, bars[i].date);
    return { val: e != null && e <= 0 ? "loss-making" : "no data", pe: null, pct: null, vsTrade: null };
  }
  const hist: number[] = [];
  for (let k = Math.max(1, i - 504); k < i; k += 5) { const v = peAt(k); if (v != null) hist.push(v); }
  if (hist.length < 40) return { val: "no data", pe: +now.toFixed(1), pct: null, vsTrade: null };
  const pct = hist.filter((v) => v < now).length / hist.length;
  const val: Valuation = pct <= 0.33 ? "cheap" : pct >= 0.67 ? "expensive" : "middle";
  const long = side === "long";
  const vsTrade = val === "middle" ? "neutral" : (val === "cheap") === long ? "aligned" : "against";
  return { val, pe: +now.toFixed(1), pct: +pct.toFixed(2), vsTrade };
}
