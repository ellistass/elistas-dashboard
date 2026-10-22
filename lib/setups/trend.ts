// lib/setups/trend.ts — the trend slot: a 55-day closing breakout on markets that
// trended in both 2018–21 and 2022–26 (Oct 2026 test, project doc
// trend-following-test-oct2026). Its own single slot, half risk, paper during the
// forward test — it never shares the 3 range slots.
//
// Rules: the last completed daily bar CLOSES above the highest high (long) / below
// the lowest low (short) of the previous 55 bars → enter at the next open, stop
// 2 × ATR(20), breakeven at +1R, then trail 3 × ATR behind the best price, no target.
import { BASKET } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { completedBars } from "./scan";
import type { Bar } from "@/lib/wyckoff/engine";

import { TREND_MARKETS, type TrendSetup } from "./trendMarkets";
export { TREND_MARKETS, type TrendSetup };
const N = 55, ATR_N = 20, STOP_ATR = 2, TRAIL_ATR = 3;


const atrAt = (b: Bar[], i: number) => {
  let s = 0;
  for (let k = i - ATR_N + 1; k <= i; k++) s += Math.max(b[k].h, b[k - 1].c) - Math.min(b[k].l, b[k - 1].c);
  return s / ATR_N;
};

export function trendSignal(bars: Bar[], instrument: string, executeSymbol: string): TrendSetup | null {
  const i = bars.length - 1;
  if (i < N + ATR_N + 1) return null;
  const prev = bars.slice(i - N, i);
  const hh = Math.max(...prev.map((b) => b.h)), ll = Math.min(...prev.map((b) => b.l));
  const c = bars[i].c;
  const side = c > hh ? "long" : c < ll ? "short" : null;
  if (!side) return null;
  const d = side === "long" ? 1 : -1, a = atrAt(bars, i);
  return {
    instrument, executeSymbol, side, signalDate: bars[i].date, close: c, channel: side === "long" ? hh : ll,
    entryRef: c, stop: c - d * STOP_ATR * a, atr: a, breakevenAt: c + d * STOP_ATR * a, trailDistance: TRAIL_ATR * a,
    lastBarDate: bars[i].date,
  };
}

let cache: { at: number; scan: { at: string; setups: TrendSetup[]; errors: string[] } } | null = null;

export async function scanTrend(force = false): Promise<{ at: string; setups: TrendSetup[]; errors: string[] }> {
  if (!force && cache && Date.now() - cache.at < 15 * 60 * 1000) return cache.scan;
  const setups: TrendSetup[] = [], errors: string[] = [];
  await Promise.all(TREND_MARKETS.map(async (sym) => {
    const inst = BASKET.find((x) => x.symbol === sym);
    if (!inst) return;
    try {
      const bars = completedBars(await fetchDailyBars(inst.yahoo, "2y"));
      const s = trendSignal(bars, sym, inst.executeSymbol || sym);
      if (s) setups.push(s);
    } catch (e) { errors.push(`${sym}: ${e instanceof Error ? e.message : String(e)}`); }
  }));
  const scan = { at: new Date().toISOString(), setups, errors };
  cache = { at: Date.now(), scan };
  return scan;
}
