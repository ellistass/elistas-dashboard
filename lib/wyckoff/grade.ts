// lib/wyckoff/grade.ts — structural quality grade for a detected range.
//
// WHY THIS EXISTS
// The scanner surfaces every range that passes detection, which means a
// textbook spring off a well-tested floor after a 20% decline sits next to a
// scrappy 16-bar box that touched each edge the bare minimum of twice. Both
// look identical on the desk. This module scores the STRUCTURE so the good
// ones sort to the top.
//
// BLIND INTEGRITY — read before extending this.
// The grade must never encode the engine's accum/distrib verdict. It is
// computed exclusively from facts the candidate payload ALREADY discloses to
// the trader (terminal test, context %, bars in range, band width) plus two
// counts detection was already computing and throwing away (boundary touches).
// Nothing here consults effort/result, volume ratios, or engineVerdict — grep
// this file: those symbols do not appear. A grade says "this is a well-formed
// range", never "this will go up".
//
// The one judgement call: `context` scores whether a decisive prior trend
// exists AND whether its direction is consistent with the terminal test type
// (spring after a decline, upthrust after an advance). That combines two
// numbers already printed on the card, so it reveals nothing the trader cannot
// read off the chart himself — but it is the factor to remove first if the
// benchmark ever looks contaminated.

import { CFG, type Bar, type TerminalTest } from "./engine";

export interface GradeFactors {
  /** Terminal test present, and recent relative to the range end. */
  test: number;
  /** Both boundaries tested repeatedly, scored on the WEAKER side. */
  boundaries: number;
  /** A decisive prior trend, consistent with the test type. */
  context: number;
  /** Mature cause, tight band. */
  maturity: number;
}

export type Grade = "A" | "B" | "C" | "D";

export interface RangeGrade {
  /** 0..100, weighted sum of the four factors. */
  score: number;
  grade: Grade;
  factors: GradeFactors;
  /** Short human-readable reasons, rendered as chips on the card. */
  notes: string[];
}

/** Relative weights. Test dominates — it is the Wyckoff trigger, the rest is
 *  supporting evidence that the range is a real cause. */
const W = { test: 0.35, boundaries: 0.25, context: 0.2, maturity: 0.2 } as const;

const CUTOFFS: Array<{ grade: Grade; min: number }> = [
  { grade: "A", min: 78 },
  { grade: "B", min: 62 },
  { grade: "C", min: 45 },
  { grade: "D", min: 0 },
];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface GradeInput {
  bars: Bar[];
  /** Index of the first bar in the range. */
  start: number;
  /** Index of the first bar AFTER the range (breakout bar, or bars.length). */
  end: number;
  lo: number;
  hi: number;
  touchesHi: number;
  touchesLo: number;
  springIdx: number | null;
  upthrustIdx: number | null;
  terminalTest: TerminalTest;
  contextPct: number | null;
}

/* ── Factor 1: terminal test ──────────────────────────────────────────────
   A spring or upthrust is the trigger. One that printed 2 bars ago is a live
   decision; the same test 20 bars back is history the range has moved past. */
function scoreTest(i: GradeInput, notes: string[]): number {
  const testIdx = Math.max(i.springIdx ?? -1, i.upthrustIdx ?? -1);
  if (testIdx < 0) {
    notes.push("no terminal test");
    return 0;
  }
  const barsSince = i.end - 1 - testIdx;
  // Full marks inside the freshness window, then decay — but to a FLOOR, not
  // to zero. A range that has been tested and held is structurally different
  // from one that never got tested at all, however long ago it happened.
  // Without the floor an old spring scored identically to no spring.
  const STALE_FLOOR = 0.15;
  const decayed = clamp01(1 - (barsSince - CFG.FRESH_TEST_BARS) / 12);
  const recency =
    barsSince <= CFG.FRESH_TEST_BARS
      ? 1
      : STALE_FLOOR + (1 - STALE_FLOOR) * decayed;

  const label = i.springIdx === testIdx ? "spring" : "upthrust";
  notes.push(barsSince === 0 ? `${label} on the last bar` : `${label} ${barsSince} bars ago`);

  // Both directions tested means the range has rejected BOTH edges — a real
  // range, but a muddier read than a clean one-sided test. Small haircut.
  if (i.terminalTest === "both") {
    notes.push("tested both edges");
    return recency * 0.85;
  }
  return recency;
}

/* ── Factor 2: boundary quality ───────────────────────────────────────────
   Detection requires 2 touches per side. Scored on the weaker side, because a
   range with eight highs and two lows has one proven boundary, not two. */
function scoreBoundaries(i: GradeInput, notes: string[]): number {
  const weakest = Math.min(i.touchesHi, i.touchesLo);
  notes.push(`edges tested ${i.touchesLo}× / ${i.touchesHi}×`);
  return clamp01((weakest - 1) / 4); // 2 → .25, 3 → .5, 5+ → 1
}

/* ── Factor 3: context ────────────────────────────────────────────────────
   A range is a cause only if something came before it. Scores the SIZE of the
   prior move, then halves it when the move runs against what the terminal test
   implies — an upthrust at the end of a decline is a less coherent story than
   an upthrust after a run-up. */
function scoreContext(i: GradeInput, notes: string[]): number {
  if (i.contextPct == null) {
    notes.push("no context history");
    return 0.4; // unknown, not bad — don't punish a short series
  }
  const magnitude = clamp01(Math.abs(i.contextPct) / 15);
  const sign = i.contextPct >= 0 ? "+" : "";
  notes.push(`${sign}${i.contextPct.toFixed(1)}% into the range`);

  const hasSpring = i.springIdx != null;
  const hasUpthrust = i.upthrustIdx != null;
  // Only judge coherence when the prior move is decisive enough to HAVE a
  // direction. Calling a +0.5% drift "the prior trend" and penalising a spring
  // against it is noise dressed up as analysis.
  const DECISIVE_PCT = 5;
  if (Math.abs(i.contextPct) < DECISIVE_PCT) return magnitude;

  // Only judge coherence when the test points one way.
  if (hasSpring !== hasUpthrust) {
    const coherent = hasSpring ? i.contextPct < 0 : i.contextPct > 0;
    if (!coherent) {
      notes.push("test runs against the prior trend");
      return magnitude * 0.5;
    }
  }
  return magnitude;
}

/* ── Factor 4: maturity ───────────────────────────────────────────────────
   Enough bars to be a genuine cause, and tight enough to be a range rather
   than a drift. Very long ranges are not better — a box pressing MAXLEN is
   usually a trend that stalled, so the curve plateaus and then eases off. */
function scoreMaturity(i: GradeInput, notes: string[]): number {
  const bars = i.end - i.start;
  let barScore: number;
  if (bars <= CFG.MINLEN) barScore = 0.3;
  else if (bars < 30) barScore = 0.3 + (0.7 * (bars - CFG.MINLEN)) / (30 - CFG.MINLEN);
  else if (bars <= 70) barScore = 1;
  else barScore = clamp01(1 - (bars - 70) / (CFG.MAXLEN - 70)) * 0.3 + 0.7;

  const mid = (i.hi + i.lo) / 2;
  const bandFrac = mid > 0 ? (i.hi - i.lo) / mid : CFG.MAXBAND;
  const tightness = clamp01(1 - bandFrac / CFG.MAXBAND);

  notes.push(`${bars}-bar cause · band ${(bandFrac * 100).toFixed(1)}%`);
  return 0.6 * barScore + 0.4 * tightness;
}

/** Grade one detected range. Pure — bars in, score out. */
export function gradeRange(input: GradeInput): RangeGrade {
  const notes: string[] = [];
  const factors: GradeFactors = {
    test: scoreTest(input, notes),
    boundaries: scoreBoundaries(input, notes),
    context: scoreContext(input, notes),
    maturity: scoreMaturity(input, notes),
  };

  const score = Math.round(
    100 *
      (factors.test * W.test +
        factors.boundaries * W.boundaries +
        factors.context * W.context +
        factors.maturity * W.maturity),
  );

  let grade = (CUTOFFS.find((c) => score >= c.min) ?? CUTOFFS[CUTOFFS.length - 1]).grade;

  // Gate on the two load-bearing factors. Without this a range can reach A on
  // maturity and context alone — a pretty 40-bar box that was never tested and
  // whose edges were each touched the bare minimum of twice. "A" has to mean
  // the setup is actually actionable, not that it scored well on average.
  if (grade === "A" && (factors.test < 0.6 || factors.boundaries < 0.5)) {
    grade = "B";
    notes.push(factors.test < 0.6 ? "capped at B — no live test" : "capped at B — thin edges");
  }

  return { score, grade, factors, notes };
}

/** Round factors for storage — full float precision is noise here. */
export function packFactors(f: GradeFactors): Record<string, number> {
  return {
    test: Number(f.test.toFixed(3)),
    boundaries: Number(f.boundaries.toFixed(3)),
    context: Number(f.context.toFixed(3)),
    maturity: Number(f.maturity.toFixed(3)),
  };
}
