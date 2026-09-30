// lib/setups/abcd.ts — Larry Pesavento's AB=CD as a reversal entry at D. PAPER ONLY.
//
// Same NY-close daily candles as the forex retest scan (no extra fetch).
//   Swings: a zigzag that confirms a high/low once price reverses 2 × ATR(20) from it.
//   Pattern: the last three confirmed pivots A, B, C with BC/AB between 0.618 and 0.786.
//   Order:   limit at D = C ∓ AB, stop at the 1.272 extension (D ∓ 0.272 × AB),
//            target the 0.618 retrace of CD (D ± 0.618 × AB ≈ +2.3R). No trail.
//   Valid:   2 × (bars from A to B) + 5 bars after C is confirmed; cancelled if price
//            breaks C first. D already hit when C was confirmed = no setup.
//
// Backtest (28 pairs, 2021–26, fair fills, 2-pip spread): +0.32R / +0.34R per trade
// (recent / earlier), 222 trades ≈ 39 a year, win 41%, max drawdown −8.3R. FRAGILE:
// only the 2 × ATR swing size held up (1.5× / 2.5× weak, 3× lost), so it's a forward
// test. COT on it flipped between periods → shown for information, never graded.
// Never coincided with a COT retest in the same direction (0 of 95).

import type { Bar } from "@/lib/wyckoff/engine";
import type { PositioningRead } from "@/lib/data/cot";

export const ABCD = { SWING_ATR: 2, RETRACE_MIN: 0.618, RETRACE_MAX: 0.786, STOP_EXT: 0.272, TARGET_CD: 0.618 } as const;

export interface AbcdPoint { date: string; price: number }
export interface AbcdSetup {
  pair: string;
  side: "long" | "short";
  /** armed = limit at D waiting; filled = D reached on the last bar. */
  state: "armed" | "filled";
  a: AbcdPoint; b: AbcdPoint; c: AbcdPoint;
  /** When C was confirmed (the pattern became known). */
  knownDate: string;
  entry: number;        // D
  stop: number;
  target: number;
  retrace: number;      // BC / AB
  barsLeft: number;
  /** Information only — tested, it doesn't help AB=CD. */
  positioning: PositioningRead | null;
  bars: [number, number, number, number, string][];
  lastBarDate: string;
}

interface Pivot { i: number; p: number; hi: boolean; conf: number }

function atr20(b: Bar[], k: number): number {
  let a = 0;
  for (let j = k - 19; j <= k; j++) a += Math.max(b[j].h, b[j - 1].c) - Math.min(b[j].l, b[j - 1].c);
  return a / 20;
}

/** Swing highs/lows confirmed once price reverses `mult` × ATR(20) from the extreme. */
export function zigzag(b: Bar[], mult: number = ABCD.SWING_ATR): Pivot[] {
  const out: Pivot[] = [];
  if (b.length < 25) return out;
  let dir = 0, ei = 20, ep = b[20].c;
  for (let k = 21; k < b.length; k++) {
    const th = mult * atr20(b, k - 1);
    if (dir === 0) {
      if (b[k].c > b[20].c + th) { dir = 1; ei = k; ep = b[k].h; }
      else if (b[k].c < b[20].c - th) { dir = -1; ei = k; ep = b[k].l; }
      continue;
    }
    if (dir === 1) {
      if (b[k].h > ep) { ei = k; ep = b[k].h; }
      if (ep - b[k].l >= th) { out.push({ i: ei, p: ep, hi: true, conf: k }); dir = -1; ei = k; ep = b[k].l; }
    } else {
      if (b[k].l < ep) { ei = k; ep = b[k].l; }
      if (b[k].h - ep >= th) { out.push({ i: ei, p: ep, hi: false, conf: k }); dir = 1; ei = k; ep = b[k].h; }
    }
  }
  return out;
}

/** The live AB=CD on the last completed bar, or null. */
export function abcdFor(pair: string, bars: Bar[]): AbcdSetup | null {
  const n = bars.length, last = n - 1;
  const pv = zigzag(bars);
  if (pv.length < 3) return null;
  const [A, B, C] = pv.slice(-3);
  const AB = Math.abs(B.p - A.p);
  if (!(AB > 0)) return null;
  const retrace = Math.abs(C.p - B.p) / AB;
  if (retrace < ABCD.RETRACE_MIN || retrace > ABCD.RETRACE_MAX) return null;

  const long = A.hi;                                   // A high → B low → C high → buy at D (low)
  const D = long ? C.p - AB : C.p + AB;
  const stop = long ? D - ABCD.STOP_EXT * AB : D + ABCD.STOP_EXT * AB;
  const target = long ? D + ABCD.TARGET_CD * AB : D - ABCD.TARGET_CD * AB;
  if (long ? bars[C.conf].l <= D : bars[C.conf].h >= D) return null;   // through D before the pattern was known
  const maxBars = 2 * (B.i - A.i) + 5;

  let state: AbcdSetup["state"] = "armed";
  for (let k = C.conf + 1; k <= last; k++) {
    if (long ? bars[k].h > C.p : bars[k].l < C.p) return null;          // broke C → pattern void
    if (long ? bars[k].l <= D : bars[k].h >= D) {
      if (k < last) return null;                                        // filled earlier: a trade now, not a setup
      if (long ? bars[k].o < stop : bars[k].o > stop) return null;      // gapped through the stop
      state = "filled";
    }
  }
  const barsLeft = C.conf + maxBars - 1 - last;
  if (state === "armed" && barsLeft <= 0) return null;

  const pt = (p: Pivot): AbcdPoint => ({ date: bars[p.i].date, price: p.p });
  return {
    pair, side: long ? "long" : "short", state,
    a: pt(A), b: pt(B), c: pt(C), knownDate: bars[C.conf].date,
    entry: D, stop, target, retrace: +retrace.toFixed(3), barsLeft: Math.max(0, barsLeft),
    positioning: null,
    bars: bars.slice(Math.max(0, Math.min(A.i - 10, n - 120)))
      .map((b) => [b.o, b.h, b.l, b.c, b.date] as [number, number, number, number, string]),
    lastBarDate: bars[last].date,
  };
}
