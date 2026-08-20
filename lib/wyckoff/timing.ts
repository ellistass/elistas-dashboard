// lib/wyckoff/timing.ts — was the scanner early or late?
//
// The desk shows setups. It has never recorded WHEN it first showed them, so
// there is no way to ask the only question that matters about the algorithm's
// timing: by the time this landed in front of me, had the move already gone?
//
// Two independent measures, deliberately not collapsed into one verdict:
//
//   leadToBreakout — bars from the setup first appearing on the desk to the
//                    breakout bar. Positive = you had that many days to
//                    prepare. Zero or negative = it surfaced at or after the
//                    move; reading it was never a live decision.
//
//   leadToTest     — bars from surfacing to the terminal test (spring or
//                    upthrust). Positive = surfaced BEFORE the classic Wyckoff
//                    trigger printed. Negative = the test had already printed
//                    when it arrived; you met the setup late even if the
//                    breakout was still days away.
//
// A scanner can be early on one and late on the other — surfacing a range
// pressing its boundary long before any test prints scores well on
// leadToTest and badly on nothing, while a range that only surfaces once the
// breakout bar closes is late on both. Keeping them apart is what makes the
// distribution readable later.

import type { Bar } from "./engine";

export interface SetupTiming {
  leadToBreakout: number | null;
  leadToTest: number | null;
}

/** Index of the bar with this date, or -1. Dates are the series' own strings,
 *  so this is an exact match rather than a date-math comparison — trading days
 *  are what we want to count, not calendar days. */
export function barIndexOf(bars: Bar[], date: string | null | undefined): number {
  if (!date) return -1;
  const d = date.slice(0, 10);
  for (let i = 0; i < bars.length; i++) if (bars[i].date.slice(0, 10) === d) return i;
  return -1;
}

/** Trading days from `fromDate` to `toDate` within this series. Positive when
 *  `toDate` is later. Null when either date isn't in the series. */
export function barsBetween(
  bars: Bar[],
  fromDate: string | null | undefined,
  toDate: string | null | undefined,
): number | null {
  const a = barIndexOf(bars, fromDate);
  const b = barIndexOf(bars, toDate);
  if (a < 0 || b < 0) return null;
  return b - a;
}

export function computeTiming(params: {
  bars: Bar[];
  /** Data date when the setup first became fresh — NOT the wall-clock scan time. */
  surfacedBarDate: string | null | undefined;
  breakoutDate: string | null | undefined;
  testBarDate: string | null | undefined;
}): SetupTiming {
  const { bars, surfacedBarDate, breakoutDate, testBarDate } = params;
  return {
    leadToBreakout: barsBetween(bars, surfacedBarDate, breakoutDate),
    leadToTest: barsBetween(bars, surfacedBarDate, testBarDate),
  };
}

/** Phrase a lead figure for the UI. Kept here so the desk, the archive and the
 *  score page can never describe the same number three different ways. */
export function describeLead(n: number | null, subject: "breakout" | "test"): string {
  if (n == null) return "—";
  if (n === 0) return `same bar as the ${subject}`;
  if (n > 0) return `${n} bar${n === 1 ? "" : "s"} before the ${subject}`;
  return `${-n} bar${n === -1 ? "" : "s"} AFTER the ${subject}`;
}

/** Aggregate for the score page: median lead plus how often the scanner was
 *  already too late to act. Median, not mean — one 40-bar outlier should not
 *  move the headline figure. */
export function summariseLeads(values: Array<number | null>): {
  n: number;
  median: number | null;
  lateCount: number;
  latePct: number | null;
} {
  const xs = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, median: null, lateCount: 0, latePct: null };
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  const lateCount = xs.filter((v) => v <= 0).length;
  return {
    n: xs.length,
    median,
    lateCount,
    latePct: Math.round((lateCount / xs.length) * 100),
  };
}
