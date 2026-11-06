// lib/setups/market.ts — stock market state for the stock cards.
//
// healthy    = S&P 500 200-day average rising AND ≥ 50% of the scanned stocks above their own 200-day
// narrow     = 200-day rising, < 50% of stocks above theirs
// recovering = 200-day falling, ≥ 50% above
// weak       = 200-day falling, < 50% above
//
// Tested 6 Nov 2026 (project doc oi-avwap-volume-profile-test-nov2026), 46 FTMO stocks, grade A
// after short interest, 2018–Oct 2026: healthy +0.38R (n 321) vs not healthy −0.07R (n 128),
// both halves; held on 19 stocks not used to find it. Breadth from the ~45 scanned stocks
// matched the full S&P 500 version on 91% of trades (healthy +0.42R vs −0.22R). The Nasdaq
// 100 trend added nothing (when the two disagree, the S&P was right).
// RULE: stock setups are taken only in a healthy market (grade unchanged).
import type { Bar } from "@/lib/wyckoff/engine";

export type MarketState = "healthy" | "narrow" | "recovering" | "weak";
export interface MarketRead { date: string; state: MarketState; spxTrendUp: boolean; breadth: number; stocks: number }

const MIN_STOCKS = 20;

/** Per date: how many stocks closed above their own 200-day average, out of how many had 200 bars. */
export function breadthSeries(stocks: Bar[][]): Map<string, { above: number; n: number }> {
  const m = new Map<string, { above: number; n: number }>();
  for (const b of stocks) {
    let sum = 0;
    for (let i = 0; i < b.length; i++) {
      sum += b[i].c;
      if (i >= 200) sum -= b[i - 200].c;
      if (i < 199) continue;
      const e = m.get(b[i].date) ?? { above: 0, n: 0 };
      e.n++;
      if (b[i].c > sum / 200) e.above++;
      m.set(b[i].date, e);
    }
  }
  return m;
}

const sma = (b: Bar[], i: number, n: number) => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += b[j].c; return s / n; };

/** The market state on `date` (the last session on or before it). null = not enough data. */
export function marketReadAt(spx: Bar[], breadth: Map<string, { above: number; n: number }>, date: string): MarketRead | null {
  let i = -1;
  for (let k = 0; k < spx.length && spx[k].date <= date; k++) i = k;
  if (i < 220) return null;
  const d = spx[i].date, br = breadth.get(d);
  if (!br || br.n < MIN_STOCKS) return null;
  const spxTrendUp = sma(spx, i, 200) > sma(spx, i - 20, 200);
  const share = br.above / br.n, wide = share >= 0.5;
  const state: MarketState = spxTrendUp ? (wide ? "healthy" : "narrow") : (wide ? "recovering" : "weak");
  return { date: d, state, spxTrendUp, breadth: +share.toFixed(2), stocks: br.n };
}
