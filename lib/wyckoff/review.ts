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

// SUSPECT_VOLUME now lives in the instrument config (lib/wyckoff/basket) —
// derived from each instrument's audited volumeQuality, so upgrading a feed
// verdict in ONE place updates badges, the learnable filter, and the blind
// score together. Re-exported here for existing importers.
export { SUSPECT_VOLUME } from "./basket";

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

// ── Live chart (pre-resolution) ───────────────────────────────────────────────
// Bars + structure ONLY — deliberately returns NO engine internals (no ratio,
// no effort numbers, no verdict). This feeds the live-candidate chart so the
// trader can read price/volume without opening TradingView; the engine's
// reasoning stays sealed until the range resolves. Spring/upthrust indexes are
// safe: terminalTest is already disclosed in the trader payload, and the bars
// themselves show these to any eye.
export interface LiveChartData {
  bars: Bar[];
  rangeStartIdx: number;
  breakoutIdx: number | null; // null while the range is still open
  springIdx: number | null;
  upthrustIdx: number | null;
}

export function buildLiveChart(
  all: Bar[],
  rangeStartDate: string,
  breakoutDate: string | null,
  lo: number,
  hi: number,
): LiveChartData | null {
  const s = all.findIndex((b) => b.date === rangeStartDate);
  if (s < 0) return null;
  const e = breakoutDate ? all.findIndex((b) => b.date === breakoutDate) : -1;
  const from = Math.max(0, s - CFG.CONTEXT_BARS);
  const bars = all.slice(from); // through the latest bar — the decision is NOW
  const rangeStartIdx = s - from;
  const breakoutIdx = e >= 0 ? e - from : null;
  const testEnd = breakoutIdx ?? bars.length; // spring/upthrust search window
  return {
    bars,
    rangeStartIdx,
    breakoutIdx,
    springIdx: lastSpring(bars, rangeStartIdx, testEnd, lo),
    upthrustIdx: lastUpthrust(bars, rangeStartIdx, testEnd, hi),
  };
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
