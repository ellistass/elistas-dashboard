// lib/wyckoff/engine.ts — pure Wyckoff range-detection engine.
//
// Implements the Wyckoff Range Scanner spec §2–§9 exactly. Every function here
// is pure (bars in, values out) — no I/O, no DB, no dates-from-clock — so the
// whole engine is unit-testable against synthetic bars.
//
// The one extension beyond the original spec (requested at build time): ranges
// that are STILL OPEN at the right edge of the data are detected too, so the
// scanner can surface a range at its terminal test BEFORE the breakout — the
// highest-value read. Open ranges have `status: "open"` and no breakout bar.

export type Bar = { o: number; h: number; l: number; c: number; v: number; date: string };

export const CFG = {
  SEED: 8, // bars used to seed a candidate range's initial hi/lo
  MINLEN: 15, // minimum bars for a valid range
  MAXLEN: 90, // maximum bars a range can extend before forced close
  TOL_FRAC: 0.15, // boundary tolerance as fraction of band (touch/break zone)
  MAXBAND: 0.28, // reject ranges wider than 28% of mid-price (not a range)
  CONTEXT_BARS: 60, // bars before range start used to measure trend context
  DISTRIB_RATIO: 1.12, // effort/result ratio >= this => distribution
  ACCUM_RATIO: 0.89, // effort/result ratio <= this => accumulation
  RESOLVE_BARS: 12, // bars after range end used to record the eventual outcome

  // Freshness window (§10 filter — tune these, not the detection logic).
  FRESH_BREAKOUT_BARS: 5, // "just broke out" = breakout within this many bars
  FRESH_TEST_BARS: 3, // "test just printed" = spring/upthrust within this many bars of the range end
};

export type RangeStatus = "open" | "broken";

export interface DetectedRange {
  start: number; // index of first bar in the range
  end: number; // index of first bar AFTER the range: the breakout bar for
  //             "broken" ranges (or the forced-close bar at MAXLEN);
  //             equals bars.length for "open" ranges (no breakout yet)
  lo: number;
  hi: number;
  status: RangeStatus;
  /** Bars whose high reached the ceiling zone. Detection has always counted
   *  these to decide validity (>= 2 per side) and then discarded them; the
   *  quality grade scores how far past that minimum a range got. */
  touchesHi: number;
  touchesLo: number;
}

/** Drop unusable bars before any processing (spec §1). */
export function cleanBars(bars: Bar[]): Bar[] {
  return bars.filter(
    (b) =>
      b != null &&
      Number.isFinite(b.o) &&
      Number.isFinite(b.h) &&
      Number.isFinite(b.l) &&
      Number.isFinite(b.c) &&
      Number.isFinite(b.v) &&
      b.v > 0,
  );
}

// ── §3 Range detection ────────────────────────────────────────────────────────
// A range is a horizontal consolidation with floor and ceiling each touched at
// least twice. A range ENDS on a CLOSE outside the tolerance band — wicks
// through a boundary are tests (springs/upthrusts), not breaks.
//
// Deviation from the spec's loop bound (`i < n - MINLEN - RESOLVE_BARS`): we
// scan up to `n - MINLEN` so that a range still forming at the right edge of
// the data can be detected as an OPEN range. The RESOLVE_BARS margin only
// matters for outcome recording, which is backfilled later by cron anyway.
export function detectRanges(bars: Bar[]): DetectedRange[] {
  const n = bars.length;
  const ranges: DetectedRange[] = [];
  let i = 0;
  while (i <= n - CFG.MINLEN) {
    const seed = bars.slice(i, i + CFG.SEED);
    if (seed.length < CFG.SEED) break;
    const hi = Math.max(...seed.map((b) => b.h));
    const lo = Math.min(...seed.map((b) => b.l));
    const band = hi - lo;
    const mid = (hi + lo) / 2;
    if (band <= 0 || band / mid > CFG.MAXBAND) {
      i += 1; // too wide or degenerate -> not a range
      continue;
    }
    const tol = band * CFG.TOL_FRAC;
    let e = i + CFG.SEED;
    let touchesHi = 0;
    let touchesLo = 0;
    let brokeOut = false;
    while (e < n && e - i < CFG.MAXLEN) {
      const b = bars[e];
      if (b.c > hi + tol || b.c < lo - tol) {
        brokeOut = true; // a CLOSE outside the band ends the range
        break;
      }
      if (b.h >= hi - tol) touchesHi += 1;
      if (b.l <= lo + tol) touchesLo += 1;
      e += 1;
    }
    const longEnough = e - i >= CFG.MINLEN;
    const touched = touchesHi >= 2 && touchesLo >= 2;
    if (longEnough && touched && e < n) {
      // Broke out (bar `e`'s close crossed a boundary) or hit MAXLEN (forced
      // close, spec behaviour). Either way the range is complete.
      void brokeOut;
      ranges.push({ start: i, end: e, lo, hi, status: "broken", touchesHi, touchesLo });
      i = e + 1; // jump past this range
    } else if (longEnough && touched && e === n) {
      // Ran off the right edge of the data with price still inside the band:
      // the range is STILL OPEN — no breakout bar exists yet.
      ranges.push({ start: i, end: e, lo, hi, status: "open", touchesHi, touchesLo });
      i = e + 1; // (ends the loop; e === n)
    } else {
      i += 1;
    }
  }
  return ranges;
}

// ── §4 Trend context ──────────────────────────────────────────────────────────
/** % price move over CONTEXT_BARS bars leading INTO the range start. Null if
 *  there isn't enough history. */
export function contextPct(bars: Bar[], rangeStart: number): number | null {
  const a = rangeStart - CFG.CONTEXT_BARS;
  if (a < 0) return null;
  return ((bars[rangeStart].c - bars[a].c) / bars[a].c) * 100;
}

// ── §5 Terminal tests ─────────────────────────────────────────────────────────
/** LAST bar in [start, end) whose low pierces the floor but closes back inside. */
export function lastSpring(bars: Bar[], start: number, end: number, lo: number): number | null {
  let found: number | null = null;
  for (let k = start; k < end; k++) {
    const b = bars[k];
    if (b.l < lo && b.c >= lo) found = k; // pierced floor, closed back above it
  }
  return found;
}

/** LAST bar in [start, end) whose high pierces the ceiling but closes back inside. */
export function lastUpthrust(bars: Bar[], start: number, end: number, hi: number): number | null {
  let found: number | null = null;
  for (let k = start; k < end; k++) {
    const b = bars[k];
    if (b.h > hi && b.c <= hi) found = k; // pierced ceiling, closed back below it
  }
  return found;
}

export type TerminalTest = "spring" | "upthrust" | "both" | "none";

export function terminalTest(
  springIdx: number | null,
  upthrustIdx: number | null,
): TerminalTest {
  if (springIdx != null && upthrustIdx != null) return "both";
  if (springIdx != null) return "spring";
  if (upthrustIdx != null) return "upthrust";
  return "none";
}

// ── §6 Stopping action ────────────────────────────────────────────────────────
// Selling climax (high-volume, wide-range down-bar closing off its low)
// followed within 4 bars by an automatic rally (a full climax-range up-move).
// Distinguishes an exhausted base from a still-falling pause. Only meaningful
// when contextPct < 0 — the tool flags it regardless; the trader applies it.
export function stoppingAction(bars: Bar[], start: number, end: number): boolean {
  const seg = bars.slice(start, end);
  if (seg.length < 5) return false;
  const maxVol = Math.max(...seg.map((b) => b.v));
  const avgRange = seg.reduce((s, b) => s + (b.h - b.l), 0) / seg.length;
  for (let k = 1; k < seg.length; k++) {
    const b = seg[k];
    const rangeK = b.h - b.l;
    const closeOffLow = (b.c - b.l) / Math.max(rangeK, 1e-9) > 0.5; // closed in upper half
    const isClimax = b.v >= 0.9 * maxVol && rangeK >= avgRange * 1.3 && closeOffLow;
    if (isClimax) {
      // automatic rally = a sharp up-move within the next few bars
      for (let j = k + 1; j <= Math.min(k + 4, seg.length - 1); j++) {
        if (seg[j].c > b.c + (b.h - b.l)) return true; // rallied a full climax-range up
      }
    }
  }
  return false;
}

// ── §8 Engine verdict (LOGGED, NOT SHOWN) ─────────────────────────────────────
// Effort-per-result up vs down. up_v/up_r = volume spent per point of UP
// travel; dn_v/dn_r same for DOWN. Going up expensive relative to down =>
// supply present => distribution; vice versa => accumulation.
export type EngineVerdict = "accum" | "distrib" | "neutral";

export function engineVerdict(bars: Bar[], start: number, end: number): EngineVerdict {
  const seg = bars.slice(start, end);
  let upV = 0,
    upR = 0,
    dnV = 0,
    dnR = 0;
  for (let k = 1; k < seg.length; k++) {
    const dp = seg[k].c - seg[k - 1].c;
    const v = seg[k].v;
    if (dp > 0) {
      upV += v;
      upR += dp;
    } else if (dp < 0) {
      dnV += v;
      dnR += -dp;
    }
  }
  if (upR <= 0 || dnR <= 0) return "neutral";
  const ratio = upV / upR / (dnV / dnR);
  if (ratio >= CFG.DISTRIB_RATIO) return "distrib"; // up costs more effort per point => supply
  if (ratio <= CFG.ACCUM_RATIO) return "accum"; // down costs more effort per point => demand
  return "neutral";
}

// ── §9 Outcome (benchmark backfill) ───────────────────────────────────────────
export type Outcome = "up" | "down" | "chop";

/** What actually happened RESOLVE_BARS after the range ended. Only call once
 *  bars.length - 1 >= end + RESOLVE_BARS (otherwise the answer isn't final). */
export function outcome(bars: Bar[], end: number, lo: number, hi: number): Outcome {
  const j = Math.min(end + CFG.RESOLVE_BARS, bars.length - 1);
  const px = bars[j].c;
  if (px > hi) return "up";
  if (px < lo) return "down";
  return "chop";
}

/** True once enough forward bars exist for outcome() to be final. */
export function outcomeReady(barCount: number, end: number): boolean {
  return barCount - 1 >= end + CFG.RESOLVE_BARS;
}

// ── §10 Freshness filter (payload only — every range is persisted regardless) ─
// "Fresh" =
//   Case 1: still open AND at a decision point (terminal test just printed,
//           or price pressing a boundary) — the pre-breakout read.
//   Case 2: broke out within the last FRESH_BREAKOUT_BARS bars — the
//           break-and-retest read.
/** WHY a range is at a decision point. Persisted with the candidate so the desk
 *  can say what put each card in front of you — and so "the scanner surfaces
 *  everything at the breakout" becomes a measurable claim rather than a
 *  suspicion. Not a verdict: it describes what the scanner saw, never what it
 *  concluded. */
export type FreshReason = "test-printed" | "pressing-boundary" | "just-broke-out";

export function freshReason(
  bars: Bar[],
  range: DetectedRange,
  springIdx: number | null,
  upthrustIdx: number | null,
): FreshReason | null {
  const lastIdx = bars.length - 1;
  const barsSinceBreakout = lastIdx - range.end;

  // Case 1: still open, at a decision point
  const stillOpen = range.status === "open" || barsSinceBreakout <= 1;
  if (stillOpen) {
    const testIdx = Math.max(springIdx ?? -1, upthrustIdx ?? -1);
    const testJustPrinted = testIdx >= 0 && testIdx >= range.end - CFG.FRESH_TEST_BARS;
    // Test first: when both are true, the test is the more specific reason and
    // the one worth measuring lead time against.
    if (testJustPrinted) return "test-printed";
    if (pressingBoundary(bars, range)) return "pressing-boundary";
  }

  // Case 2: just broke out
  if (range.status === "broken" && barsSinceBreakout >= 0 && barsSinceBreakout <= CFG.FRESH_BREAKOUT_BARS) {
    return "just-broke-out";
  }
  return null;
}

export function isFresh(
  bars: Bar[],
  range: DetectedRange,
  springIdx: number | null,
  upthrustIdx: number | null,
): boolean {
  return freshReason(bars, range, springIdx, upthrustIdx) != null;
}

/** Last bar's high/low within the tolerance zone of a boundary. */
export function pressingBoundary(bars: Bar[], range: DetectedRange): boolean {
  const last = bars[bars.length - 1];
  const tol = (range.hi - range.lo) * CFG.TOL_FRAC;
  return last.h >= range.hi - tol || last.l <= range.lo + tol;
}
