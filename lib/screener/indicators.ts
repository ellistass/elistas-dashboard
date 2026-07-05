// lib/screener/indicators.ts — pure indicator math on H4 candles.
// Wilder's smoothing throughout (matches MT4's built-in ADX), so the numbers
// here line up with what the user sees on their MT4 charts.

import type { Candle } from "./yahoo";

// ── Wilder ADX(14) with +DI / -DI ─────────────────────────────────────────────
// Returns full series so callers can check slope (adx[i] vs adx[i-5]).

export interface AdxPoint {
  adx: number;
  plusDi: number;
  minusDi: number;
}

export function adxSeries(candles: Candle[], period = 14): AdxPoint[] {
  const n = candles.length;
  if (n < period * 2 + 1) return [];

  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing: first value = sum of first `period`, then smooth = prev - prev/period + current
  let smTr = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smPlus = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let smMinus = minusDm.slice(0, period).reduce((a, b) => a + b, 0);

  const dx: number[] = [];
  const diPoints: Array<{ plusDi: number; minusDi: number }> = [];

  for (let i = period; i < tr.length; i++) {
    smTr = smTr - smTr / period + tr[i];
    smPlus = smPlus - smPlus / period + plusDm[i];
    smMinus = smMinus - smMinus / period + minusDm[i];

    const plusDi = smTr === 0 ? 0 : (100 * smPlus) / smTr;
    const minusDi = smTr === 0 ? 0 : (100 * smMinus) / smTr;
    const diSum = plusDi + minusDi;
    dx.push(diSum === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / diSum);
    diPoints.push({ plusDi, minusDi });
  }

  // ADX = Wilder-smoothed DX
  const out: AdxPoint[] = [];
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push({ adx, ...diPoints[period - 1] });
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
    out.push({ adx, ...diPoints[i] });
  }
  return out;
}

// ── EMA ───────────────────────────────────────────────────────────────────────

export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

// ── ATR(14) as % of last close — volatility context for sizing/filtering ────

export function atrPercent(candles: Candle[], period = 14): number {
  const n = candles.length;
  if (n < period + 1) return 0;
  const tr: number[] = [];
  for (let i = n - period; i < n; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atr = tr.reduce((a, b) => a + b, 0) / period;
  const lastClose = candles[n - 1].close;
  return lastClose === 0 ? 0 : (atr / lastClose) * 100;
}

// ── Kaufman Efficiency Ratio ──────────────────────────────────────────────────
// ER = |net change over N bars| / sum of |bar-to-bar changes|.
// 1.0 = perfect straight-line trend, ~0 = price travelled far but went nowhere
// (a range). No smoothing, no lag — the cleanest single trend/range number.

export function efficiencyRatio(closes: number[], period = 20): number {
  if (closes.length < period + 1) return 0;
  const slice = closes.slice(-(period + 1));
  const net = Math.abs(slice[slice.length - 1] - slice[0]);
  let travel = 0;
  for (let i = 1; i < slice.length; i++) travel += Math.abs(slice[i] - slice[i - 1]);
  return travel === 0 ? 0 : net / travel;
}

// ── Range bounds: box the last N bars and locate price inside it ─────────────
// For range classification: how wide is the box in ATR multiples (big range =
// room for H1 to trend inside it), and where is price in the box (near an edge
// = reversal watch — spring at the bottom, upthrust at the top).

export interface RangeBounds {
  high: number;
  low: number;
  widthAtr: number;      // (high - low) / ATR(14) — 4+ = "big" range
  pricePosition: number; // 0 = at range low, 1 = at range high
}

export function rangeBounds(candles: Candle[], lookback = 40, atrPeriod = 14): RangeBounds | null {
  if (candles.length < Math.max(lookback, atrPeriod + 1)) return null;
  const window = candles.slice(-lookback);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const lastClose = candles[candles.length - 1].close;

  // ATR(14) in price units
  const n = candles.length;
  const tr: number[] = [];
  for (let i = n - atrPeriod; i < n; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atr = tr.reduce((a, b) => a + b, 0) / atrPeriod;
  if (atr === 0 || high === low) return null;

  return {
    high,
    low,
    widthAtr: (high - low) / atr,
    pricePosition: (lastClose - low) / (high - low),
  };
}

// ── Swing structure: HH/HL (long) or LH/LL (short) over recent pivots ────────
// A pivot high is a bar whose high exceeds the `w` bars either side (pivot low
// mirrored). We take the last 3 pivots of each kind and check ordering.

export function swingStructure(candles: Candle[], w = 3): "long" | "short" | "none" {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = w; i < candles.length - w; i++) {
    const isHigh = candles.slice(i - w, i + w + 1).every((c) => c.high <= candles[i].high);
    const isLow = candles.slice(i - w, i + w + 1).every((c) => c.low >= candles[i].low);
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (h.length < 2 || l.length < 2) return "none";

  const hh = h.every((v, i) => i === 0 || v > h[i - 1]);
  const hl = l.every((v, i) => i === 0 || v > l[i - 1]);
  const lh = h.every((v, i) => i === 0 || v < h[i - 1]);
  const ll = l.every((v, i) => i === 0 || v < l[i - 1]);

  if (hh && hl) return "long";
  if (lh && ll) return "short";
  return "none";
}
