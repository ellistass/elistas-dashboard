// lib/swing/vol.ts — how volatile a market is right now, for the cards (information),
// and the ATR the index trail uses.
//
// Tested (Sep 2026, A-grades, 2024– / 2021–23):
//   indices: trail 2 × ATR after +1R  +0.64R / +0.96R  vs 1R trail +0.37R / +0.42R → used
//   stocks +0.19 / +0.27 vs +0.20 / +0.06, commodities mixed, forex COT A worse → 1R kept
//   volatility regime on forex COT A: no consistent effect → shown, never graded

type OHLC = { h: number; l: number; c: number };

/** ATR(20) ending at bar k (needs k ≥ 20). */
export function atr20<T extends OHLC>(b: T[], k: number): number {
  let a = 0;
  for (let j = k - 19; j <= k; j++) a += Math.max(b[j].h, b[j - 1].c) - Math.min(b[j].l, b[j - 1].c);
  return a / 20;
}

/** Trail distance after +1R, as a multiple of ATR(20). null = trail 1R (everything but indices). */
export const INDEX_TRAIL_ATR = 2;

export interface VolRead {
  atr: number;
  atrPct: number;          // ATR as a share of price
  rInAtr: number;          // 1R measured in ATRs
  ratio: number;           // ATR ÷ its median over the last year
  regime: "low" | "normal" | "high";
}

export function volRead<T extends OHLC>(bars: T[], entry: number, stop: number): VolRead | null {
  const k = bars.length - 1;
  if (k < 40) return null;
  const atr = atr20(bars, k);
  const hist: number[] = [];
  for (let j = Math.max(20, k - 250); j < k; j += 5) hist.push(atr20(bars, j));
  hist.sort((a, b) => a - b);
  const med = hist[Math.floor(hist.length / 2)];
  const ratio = med > 0 ? atr / med : 1;
  return {
    atr, atrPct: entry ? atr / Math.abs(entry) : 0,
    rInAtr: atr > 0 ? Math.abs(entry - stop) / atr : 0,
    ratio: +ratio.toFixed(2),
    regime: ratio >= 1.3 ? "high" : ratio <= 0.75 ? "low" : "normal",
  };
}
