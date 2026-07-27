// lib/wyckoff/review.ts — pure computation for the resolved-case Review tool.
//
// Post-mortem study of a FINISHED range: slices the bar window
// [rangeStart − CONTEXT_BARS .. breakout + RESOLVE_BARS], recomputes the §8
// engine internals for display (up/dn effort-per-point, final ratio, and the
// bar-by-bar RUNNING ratio so the replay can show where the verdict tipped),
// and relocates the terminal-test / breakout markers.
//
// The blind wall lives in the API route (resolved-only); this module is pure
// math and safe to unit-test.

import { CFG, lastSpring, lastUpthrust, type Bar } from "./engine";

// Instruments whose Yahoo volume is a broken subsample (verified: GC=F prints
// tens of contracts/day vs a real ~250k). The engine's verdict on these may
// reflect bad DATA, not bad reasoning — never draw a volume lesson from them.
// Index futures (ES/NQ/YM/RTY) checked out fine; stocks/ETFs are consolidated
// tape. Spec addendum §3 list, verbatim.
export const SUSPECT_VOLUME = new Set([
  "GC", "SI", "HG", "CL", "NG",
  "6E", "6B", "6A", "6C", "6J", "6S", "6N",
]);

export interface ReviewComputation {
  bars: Bar[]; // sliced window, chronological
  rangeStartIdx: number; // indexes into the SLICED array
  breakoutIdx: number; // the bar whose close crossed a boundary
  resolveIdx: number; // the bar that determined the outcome (end + RESOLVE_BARS, clamped)
  springIdx: number | null;
  upthrustIdx: number | null;
  upEffortPerPoint: number | null; // Σ up-volume / Σ points gained
  dnEffortPerPoint: number | null; // Σ dn-volume / Σ points lost
  ratio: number | null; // final §8 ratio
  runningRatio: (number | null)[]; // per sliced bar: cumulative ratio up to that
  //                                  bar inside the range; null outside/undefined
}

/** Locate the stored range inside a freshly fetched series and compute the
 *  replay payload. Returns null if the stored dates can't be found (series
 *  too short or symbol history revised). */
export function buildReview(
  all: Bar[],
  rangeStartDate: string, // YYYY-MM-DD, as persisted
  breakoutDate: string,
  lo: number,
  hi: number,
): ReviewComputation | null {
  const s = all.findIndex((b) => b.date === rangeStartDate);
  const e = all.findIndex((b) => b.date === breakoutDate);
  if (s < 0 || e < 0 || e <= s) return null;

  const from = Math.max(0, s - CFG.CONTEXT_BARS);
  const to = Math.min(all.length - 1, e + CFG.RESOLVE_BARS);
  const bars = all.slice(from, to + 1);
  const rangeStartIdx = s - from;
  const breakoutIdx = e - from;
  const resolveIdx = to - from;

  // §8 internals over the range bars [rangeStartIdx, breakoutIdx), plus the
  // running ratio so the replay shows the verdict forming bar by bar.
  let upV = 0, upR = 0, dnV = 0, dnR = 0;
  const runningRatio: (number | null)[] = bars.map(() => null);
  for (let k = rangeStartIdx + 1; k < breakoutIdx; k++) {
    const dp = bars[k].c - bars[k - 1].c;
    const v = bars[k].v;
    if (dp > 0) { upV += v; upR += dp; }
    else if (dp < 0) { dnV += v; dnR += -dp; }
    runningRatio[k] = upR > 0 && dnR > 0 ? (upV / upR) / (dnV / dnR) : null;
  }
  const upEffortPerPoint = upR > 0 ? upV / upR : null;
  const dnEffortPerPoint = dnR > 0 ? dnV / dnR : null;
  const ratio =
    upEffortPerPoint != null && dnEffortPerPoint != null && dnEffortPerPoint > 0
      ? upEffortPerPoint / dnEffortPerPoint
      : null;

  return {
    bars,
    rangeStartIdx,
    breakoutIdx,
    resolveIdx,
    springIdx: lastSpring(bars, rangeStartIdx, breakoutIdx, lo),
    upthrustIdx: lastUpthrust(bars, rangeStartIdx, breakoutIdx, hi),
    upEffortPerPoint,
    dnEffortPerPoint,
    ratio,
    runningRatio,
  };
}
