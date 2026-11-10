// lib/setups/trend.ts — the trend slot: a 55-day closing breakout on markets that
// trended in both 2018–21 and 2022–26 (Oct 2026 test, project doc
// trend-following-test-oct2026). Its own single slot, half risk, paper during the
// forward test — it never shares the 3 range slots.
//
// Rules: the last completed daily bar CLOSES above the highest high (long) / below
// the lowest low (short) of the previous 55 bars → enter at the next open, stop
// 2 × ATR(20), breakeven at +1R, then trail 3 × ATR behind the best price, no target.
//
// Trend-slot rules (Nov 2026 test, these 10 markets, 2018 – Oct 2026; not the crypto slot):
//   longs only — longs +0.51R / +0.59R per trade (2018–mid-22 / since), shorts +0.19R / −0.44R;
//   skip longs already > 20% above the 200-day — +0.17R (both halves) vs +0.63R for the rest;
//   skip breakouts that close in the lower half of the day's range — 30% win, +0.07R (30 trades);
//   half off at +0.5R, stop to breakeven, trail the rest 3 × ATR — 76% win (84 trades), still paper.
import { BASKET } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { completedBars } from "./scan";
import type { Bar } from "@/lib/wyckoff/engine";

import { TREND_MARKETS, CRYPTO_MARKETS, TREND_PARTIAL, type TrendSetup } from "./trendMarkets";
export { TREND_MARKETS, CRYPTO_MARKETS, type TrendSetup };
const N = 55, ATR_N = 20, STOP_ATR = 2, TRAIL_ATR = 3, MAX_ABOVE_200 = 0.2;


const atrAt = (b: Bar[], i: number) => {
  let s = 0;
  for (let k = i - ATR_N + 1; k <= i; k++) s += Math.max(b[k].h, b[k - 1].c) - Math.min(b[k].l, b[k - 1].c);
  return s / ATR_N;
};

export function trendSignal(bars: Bar[], instrument: string, executeSymbol: string, slot: "trend" | "crypto" = "trend"): TrendSetup | null {
  const i = bars.length - 1;
  if (i < N + ATR_N + 1) return null;
  const prev = bars.slice(i - N, i);
  const hh = Math.max(...prev.map((b) => b.h)), ll = Math.min(...prev.map((b) => b.l));
  const c = bars[i].c;
  const side = c > hh ? "long" : c < ll ? "short" : null;
  if (!side) return null;
  const d = side === "long" ? 1 : -1, a = atrAt(bars, i);
  const sma200 = i >= 199 ? bars.slice(i - 199, i + 1).reduce((s, b) => s + b.c, 0) / 200 : null;
  const vs200 = sma200 ? c / sma200 - 1 : null;
  const ruleSkip = slot === "crypto" ? null
    : side === "short" ? "trend slot: longs only (shorts −0.44R/trade since mid-2022)"
    : vs200 != null && vs200 > MAX_ABOVE_200 ? `already ${Math.round(vs200 * 100)}% above the 200-day — late breakout (+0.17R vs +0.63R)`
    : bars[i].h > bars[i].l && (c - bars[i].l) / (bars[i].h - bars[i].l) < 0.5 ? "breakout closed in the lower half of its range — weak close (30% win, +0.07R)"
    : null;
  return {
    slot, instrument, executeSymbol, side, signalDate: bars[i].date, close: c, channel: side === "long" ? hh : ll,
    entryRef: c, stop: c - d * STOP_ATR * a, atr: a, breakevenAt: c + d * STOP_ATR * a, trailDistance: TRAIL_ATR * a,
    lastBarDate: bars[i].date,
    channelHi: hh, channelLo: ll, channelStart: prev[0].date,
    bars: bars.slice(-120).map((b) => [b.o, b.h, b.l, b.c, b.v, b.date] as [number, number, number, number, number, string]),
    vs200: vs200 == null ? null : +vs200.toFixed(3), ruleSkip,
    partialAt: slot === "crypto" ? null : c + d * TREND_PARTIAL.atR * STOP_ATR * a,
  };
}

/** Every FRESH 55-day breakout (the bar before was not one) from `fromDate` on — the Filled
 *  page replays these so the trend and crypto slots show their history, not just today. */
export function trendHistory(bars: Bar[], instrument: string, executeSymbol: string, slot: "trend" | "crypto", fromDate: string): TrendSetup[] {
  const out: TrendSetup[] = [];
  let prevSig = false;
  const first = bars.findIndex((b) => b.date >= fromDate);
  if (first < 0) return out;
  for (let i = Math.max(N + ATR_N + 1, first - 1); i < bars.length; i++) {
    const s = trendSignal(bars.slice(Math.max(0, i - 200), i + 1), instrument, executeSymbol, slot);
    if (s && !prevSig && bars[i].date >= fromDate) out.push(s);
    prevSig = !!s;
  }
  return out;
}

export { cryptoDone };

/** Crypto trades 7 days a week: keep every bar except today's unfinished UTC bar. */
const cryptoDone = (bars: Bar[]) => {
  const today = new Date().toISOString().slice(0, 10);
  return bars.filter((b) => b.date < today);
};

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
  await Promise.all(Object.entries(CRYPTO_MARKETS).map(async ([sym, m]) => {
    try {
      const bars = cryptoDone(await fetchDailyBars(m.yahoo, "2y"));
      const s = trendSignal(bars, sym, m.ftmo, "crypto");
      if (s) setups.push(s);
    } catch (e) { errors.push(`${sym}: ${e instanceof Error ? e.message : String(e)}`); }
  }));
  const scan = { at: new Date().toISOString(), setups, errors };
  cache = { at: Date.now(), scan };
  return scan;
}
