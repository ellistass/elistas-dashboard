// lib/wyckoff/entry.ts — the two ways into a Wyckoff range, priced.
//
// A range gives you exactly two honest entries, and they are a trade-off, not
// a preference:
//
//   AGGRESSIVE — at the terminal test, inside the box.
//     Long: buy the spring — price pierced the floor, took the stops under it,
//     and closed back inside. Stop goes under the spring's wick, which is the
//     tightest stop the structure ever offers, so the reward-to-risk is the
//     best you will get. You are paying for it by being early: nothing has
//     confirmed yet, and a floor that breaks for real looks identical right up
//     until it doesn't.
//
//   CONSERVATIVE — on the retest, outside the box.
//     Long: wait for a close above the ceiling, then buy the pullback into it
//     as the old resistance becomes support. The range has done what you said
//     it would before you commit a cent. You pay for that in distance — entry
//     is a whole band higher, the stop is wider relative to the move left, and
//     roughly half of these never come back to be filled.
//
// Both are priced off the SAME structure, so the numbers are comparable and
// the choice is yours to make on the day rather than by habit.
//
// Pure functions: range geometry and bars in, levels out. No I/O, no clock.

import { CFG } from "./engine";

export type EntryStyle = "aggressive" | "conservative";
export type Direction = "long" | "short";

export interface EntryPlan {
  style: EntryStyle;
  direction: Direction;
  /** Where to get in. */
  entry: number;
  /** Where the read is wrong. */
  stop: number;
  /** The opposite boundary — the range's own width, the first place to trim. */
  target1: number;
  /** Measured move: one full range height beyond the break. */
  target2: number;
  /** Distance from entry to stop, in price. */
  risk: number;
  /** Reward-to-risk to target2. Null when risk is degenerate. */
  rr: number | null;
  /** Short label for the card. */
  label: string;
  /** One line saying what you are actually doing, and what it costs. */
  note: string;
  /** True when this entry is live NOW rather than hypothetical. */
  available: boolean;
  /** Why it is not live yet, when it isn't. */
  pending: string | null;
}

export interface EntryInput {
  rangeLo: number;
  rangeHi: number;
  /** "accum" reads long, "distrib" reads short. Anything else yields no plan. */
  verdict: string | null;
  status: "open" | "broken";
  /** The terminal test's own bar, when the scanner recorded one — its wick is
   *  a better stop than the range boundary, because it is where the market
   *  actually proved the level. */
  testBar?: { h: number; l: number } | null;
  /** Most recent close, for deciding whether an entry is live yet. */
  lastClose?: number | null;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Price both entries for one range.
 *
 * Returns [] when there is no direction to price — a "pass" read, or no read
 * yet. That is deliberate: a card with no locked read is direction-neutral by
 * design, and printing a long entry on it would be a verdict in disguise.
 */
export function entryPlans(input: EntryInput): EntryPlan[] {
  const { rangeLo, rangeHi, verdict, status, testBar, lastClose } = input;
  if (verdict !== "accum" && verdict !== "distrib") return [];
  const band = rangeHi - rangeLo;
  if (!(band > 0)) return [];

  const long = verdict === "accum";
  const direction: Direction = long ? "long" : "short";
  // The same tolerance the detector uses to decide a touch from a break, so
  // "the edge zone" means one thing across the whole system.
  const tol = band * CFG.TOL_FRAC;

  // ── Aggressive: buy the floor / sell the ceiling ──────────────────────────
  // Entry sits just inside the boundary — where a spring closes back to. The
  // stop goes beyond the test's actual wick when we have it (that low is what
  // the market defended); otherwise a quarter-tolerance beyond the boundary.
  const aggEntry = long ? rangeLo + tol : rangeHi - tol;
  const wick = long ? testBar?.l : testBar?.h;
  const aggStop = long
    ? Math.min(wick ?? rangeLo, rangeLo) - tol * 0.25
    : Math.max(wick ?? rangeHi, rangeHi) + tol * 0.25;

  // ── Conservative: buy the retest of the broken ceiling / sell the floor ───
  const consEntry = long ? rangeHi : rangeLo;
  // Back inside the box means the break failed. Half a tolerance in gives the
  // retest room to overshoot without stopping you on the wick that fills you.
  const consStop = long ? rangeHi - tol * 1.5 : rangeLo + tol * 1.5;

  const t1 = long ? rangeHi : rangeLo;
  const t2 = long ? rangeHi + band : rangeLo - band;

  const build = (
    style: EntryStyle,
    entry: number,
    stop: number,
    label: string,
    note: string,
    available: boolean,
    pending: string | null,
  ): EntryPlan => {
    const risk = Math.abs(entry - stop);
    return {
      style, direction,
      entry: r6(entry), stop: r6(stop), target1: r6(t1), target2: r6(t2),
      risk: r6(risk),
      rr: risk > 0 ? Math.round((Math.abs(t2 - entry) / risk) * 10) / 10 : null,
      label, note, available, pending,
    };
  };

  const hasTest = wick != null;
  // Still inside the box = the aggressive entry is a live decision. Once price
  // has closed out of the range, buying the floor is buying a level that has
  // already been abandoned.
  const aggLive = status === "open";
  // The retest is only real once something has broken.
  const consLive = status === "broken";

  return [
    build(
      "aggressive",
      aggEntry,
      aggStop,
      long ? "at the spring" : "at the upthrust",
      hasTest
        ? `Into the ${long ? "floor" : "ceiling"} zone, stop beyond the test's own wick — the tightest stop the structure offers, and no confirmation at all.`
        : `Into the ${long ? "floor" : "ceiling"} zone. No terminal test has printed yet, so the stop is set off the boundary — earlier and thinner than a spring would give you.`,
      aggLive,
      aggLive ? null : "range already broke — this level is behind price",
    ),
    build(
      "conservative",
      consEntry,
      consStop,
      "on the retest",
      `Wait for the close ${long ? "above the ceiling" : "below the floor"}, then take the pullback into it. The range proves itself first; you pay a full band for the proof, and roughly half never come back to fill.`,
      consLive,
      consLive ? null : "no breakout yet — nothing to retest",
    ),
  ];
}

/** Pull the terminal test's bar out of the packed sparkBars window by date.
 *  Tuple format is [o,h,l,c,v,date] — see the sparkBars note in scan.ts. */
export function findTestBar(
  sparkBars: unknown,
  testBarDate: string | null | undefined,
): { h: number; l: number } | null {
  if (!testBarDate || !Array.isArray(sparkBars)) return null;
  const day = testBarDate.slice(0, 10);
  for (const b of sparkBars as Array<Array<number | string>>) {
    if (Array.isArray(b) && String(b[5]).slice(0, 10) === day) {
      const h = Number(b[1]);
      const l = Number(b[2]);
      if (Number.isFinite(h) && Number.isFinite(l)) return { h, l };
    }
  }
  return null;
}
