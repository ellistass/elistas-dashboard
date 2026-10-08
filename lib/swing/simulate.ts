// lib/swing/simulate.ts — what a logged setup did under the mechanical rules.
// Pure: bars in, outcome out. Used by the Journal's results table.
//
// Rules (same as the card and the backtest):
//   entry  — "limit": at the edge, valid for `goodFor` bars (a gap through the
//            limit fills at the open); "open": market at the next open;
//            "filled": the fill happened on the bar the setup was first seen.
//   manage — stop in force from the previous close; +1R touched → stop to
//            breakeven, then trail 1R behind the best price; stops only move in
//            your favour; cap (if any) takes profit; 60 bars held → exit at the close.
//   Same-bar stop and target → the stop wins (conservative). Gaps fill at the open.

import type { DayBar, Side } from "./core";

export interface SimInput {
  side: Side;                 // in the SERIES' terms (the read side for futures)
  entryKind: "limit" | "open" | "filled";
  entryPrice: number;
  stop: number;
  cap: number | null;
  firstBarDate: string;       // the last completed bar when the setup was first seen
  goodFor: number;            // bars a limit stays valid
  maxHold?: number;
  /** false = no breakeven/trail: stop and cap only (AB=CD, as tested). Default true. */
  trail?: boolean;
  /** Trail distance after +1R as a multiple of ATR(20); absent = 1R. Indices use 2. */
  trailAtr?: number | null;
}

export type SimOutcome = "win" | "loss" | "be" | "expired" | "open";

export interface SimResult {
  outcome: SimOutcome;
  fillDate: string | null;
  fillPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: "stop" | "trail" | "cap" | "time" | null;
  resultR: number | null;     // mark-to-market for "open"
  peakR: number | null;
}

export function simulate(p: SimInput, bars: DayBar[]): SimResult {
  const d = p.side === "long" ? 1 : -1;
  const maxHold = p.maxHold ?? 60;
  const after = bars.filter((b) => b.date > p.firstBarDate);
  const none: SimResult = { outcome: "expired", fillDate: null, fillPrice: null, exitDate: null, exitPrice: null, exitReason: null, resultR: null, peakR: null };

  // ── Fill ───────────────────────────────────────────────────────────────────
  let fillIdx = -1, fill = p.entryPrice, fillDate: string | null = null;
  let manageFrom = 0;              // index of the first bar managed AFTER the fill bar
  if (p.entryKind === "filled") {
    fillDate = p.firstBarDate; manageFrom = 0;
  } else if (p.entryKind === "open") {
    const b = after[0];
    if (!b) return { ...none, outcome: "open" };
    // Skip if the open is already beyond the stop (the card's "skip if").
    if (d * (b.o - p.stop) <= 0) return none;
    fill = b.o; fillIdx = 0; fillDate = b.date; manageFrom = 0;   // the fill bar itself is managed from its open
  } else {
    for (let i = 0; i < Math.min(p.goodFor, after.length); i++) {
      const b = after[i];
      const touched = d > 0 ? b.l <= p.entryPrice : b.h >= p.entryPrice;
      if (touched) {
        fill = d > 0 ? Math.min(b.o, p.entryPrice) : Math.max(b.o, p.entryPrice);
        fillIdx = i; fillDate = b.date; manageFrom = i;          // fill bar managed too (stop can hit the same day)
        break;
      }
    }
    if (fillIdx < 0) return after.length < p.goodFor ? { ...none, outcome: "open" } : none;
  }

  const R = Math.abs(fill - p.stop);
  if (!(R > 0)) return none;
  const r = (px: number) => (d * (px - fill)) / R;

  // ── Manage ────────────────────────────────────────────────────────────────
  let stop = p.stop, best = fill, held = 0;
  const done = (date: string, px: number, why: SimResult["exitReason"]): SimResult => {
    const res = r(px);
    return {
      outcome: res > 0.05 ? "win" : res < -0.05 ? "loss" : "be",
      fillDate, fillPrice: fill, exitDate: date, exitPrice: px, exitReason: why,
      resultR: +res.toFixed(3), peakR: +r(best).toFixed(3),
    };
  };
  for (let i = manageFrom; i < after.length; i++) {
    const b = after[i];
    const isFillBar = i === fillIdx;
    // Stop: a gap through it fills at the open. On the fill bar the open is before the fill, so use the stop.
    if (d > 0 ? b.l <= stop : b.h >= stop) {
      const px = !isFillBar && (d > 0 ? b.o < stop : b.o > stop) ? b.o : stop;
      return done(b.date, px, stop === p.stop ? "stop" : "trail");
    }
    if (p.cap != null && (d > 0 ? b.h >= p.cap : b.l <= p.cap)) {
      const px = !isFillBar && (d > 0 ? b.o > p.cap : b.o < p.cap) ? b.o : p.cap;
      return done(b.date, px, "cap");
    }
    const ext = d > 0 ? b.h : b.l;
    if (d * (ext - best) > 0) best = ext;
    held++;
    if (held >= maxHold) return done(b.date, b.c, "time");
    // Adjusted once a day after the close.
    if (p.trail !== false && r(best) >= 1) {
      let gap = R;
      if (p.trailAtr) {
        const k = bars.indexOf(b);
        if (k > 20) { let a = 0; for (let j = k - 19; j <= k; j++) a += Math.max(bars[j].h, bars[j - 1].c) - Math.min(bars[j].l, bars[j - 1].c); gap = p.trailAtr * (a / 20); }
      }
      const trail = best - d * gap;
      stop = d > 0 ? Math.max(stop, trail) : Math.min(stop, trail);
    }
  }
  const last = after[after.length - 1];
  return {
    outcome: "open", fillDate, fillPrice: fill, exitDate: null, exitPrice: null, exitReason: null,
    resultR: last ? +r(last.c).toFixed(3) : 0, peakR: +r(best).toFixed(3),
  };
}

// ── Results table stats ──────────────────────────────────────────────────────

export interface GroupStats { n: number; avgR: number | null; winPct: number | null; maxDD: number | null; longestLosing: number | null }

/** `rs` in chronological order (by exit date). */
export function stats(rs: number[]): GroupStats {
  if (!rs.length) return { n: 0, avgR: null, winPct: null, maxDD: null, longestLosing: null };
  let cum = 0, peak = 0, dd = 0, streak = 0, longest = 0;
  for (const x of rs) {
    cum += x; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak);
    streak = x < 0 ? streak + 1 : 0; longest = Math.max(longest, streak);
  }
  return {
    n: rs.length,
    avgR: +(cum / rs.length).toFixed(3),
    winPct: +((100 * rs.filter((x) => x > 0).length) / rs.length).toFixed(1),
    maxDD: +dd.toFixed(2),
    longestLosing: longest,
  };
}
