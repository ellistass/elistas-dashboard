// lib/wyckoff/edge.ts — is the engine adding anything, or riding the drift?
//
// The Score page reported the engine at 56% and left it there, as though 50%
// were the thing to beat. It is not. Across every resolved range in this book
// price finished ABOVE the box 471 times and below it 316 — so on directional
// cases alone, a model that says "up" every single time and thinks about
// nothing scores 60%.
//
// By that measure the engine's 56% is not a modest edge. It is worse than a
// constant guess, and the Score page was quietly presenting it as a result.
//
// The segments invert it again, which is why raw accuracy had to go:
//
//   engine says accum   63% right  (base rate for up   60%)  →  edge +3
//   engine says distrib 48% right  (base rate for down 40%)  →  edge +8
//
// The distrib calls look far worse and carry nearly three times the edge. The
// accum calls look strong and are very nearly just the drift. No amount of
// staring at 63% and 48% gets you there; you have to subtract the base rate,
// so that is what this module does and what the UI now shows.
//
// Everything here is measured from the trader's own resolved history. Nothing
// is assumed about markets in general.

import { rate, type Rate } from "../stats";

export interface EdgeRow {
  instrument: string;
  outcome: string | null;
  engineVerdict: string | null;
  terminalTest?: string | null;
  grade?: string | null;
}

/** What price did, ignoring every model. The thing any call has to beat. */
export interface BaseRates {
  up: number;
  down: number;
  chop: number;
  directional: number;
  /** P(up | the range resolved directionally). */
  pUp: number;
  /** P(down | directional). */
  pDown: number;
}

export function baseRates(rows: EdgeRow[]): BaseRates {
  const up = rows.filter((r) => r.outcome === "up").length;
  const down = rows.filter((r) => r.outcome === "down").length;
  const chop = rows.filter((r) => r.outcome === "chop").length;
  const directional = up + down;
  return {
    up, down, chop, directional,
    pUp: directional ? up / directional : 0.5,
    pDown: directional ? down / directional : 0.5,
  };
}

const isHit = (r: EdgeRow): boolean =>
  (r.engineVerdict === "accum" && r.outcome === "up") ||
  (r.engineVerdict === "distrib" && r.outcome === "down");

const isDirectionalCall = (r: EdgeRow): boolean =>
  (r.engineVerdict === "accum" || r.engineVerdict === "distrib") &&
  (r.outcome === "up" || r.outcome === "down");

export interface EdgeResult {
  /** Raw accuracy, with its sample size. */
  accuracy: Rate;
  /** What guessing this call's direction every time would have scored. */
  basePct: number | null;
  /** Accuracy minus base, in percentage points. The number that matters. */
  edgePts: number | null;
  /** True when the edge clears the accuracy's own margin of error. */
  real: boolean;
  /** One line, ready to render. */
  verdict: string;
}

/**
 * Score one slice of calls against the base rate for the direction it called.
 *
 * `direction` is what these calls predicted, so the right comparison is the
 * frequency of THAT outcome — not 50%, and not the overall hit rate. Mixing
 * accum and distrib calls into one figure is what hid the asymmetry.
 */
export function edgeFor(
  rows: EdgeRow[],
  base: BaseRates,
  direction: "accum" | "distrib" | "both",
): EdgeResult {
  const calls = rows.filter(isDirectionalCall).filter((r) =>
    direction === "both" ? true : r.engineVerdict === direction,
  );
  const accuracy = rate(calls.filter(isHit).length, calls.length);

  if (accuracy.pct == null) {
    return {
      accuracy, basePct: null, edgePts: null, real: false,
      verdict: `${calls.length} call${calls.length === 1 ? "" : "s"} — too few to judge`,
    };
  }

  // For a mixed slice the base is the accuracy a constant guess would get,
  // which is the frequency of whichever direction it would always pick — the
  // more common one. That is the honest bar: nobody would adopt the worse
  // constant guess.
  const basePct =
    direction === "accum" ? Math.round(base.pUp * 100)
    : direction === "distrib" ? Math.round(base.pDown * 100)
    : Math.round(Math.max(base.pUp, base.pDown) * 100);

  const edgePts = accuracy.pct - basePct;
  // The edge has to clear the noise on the accuracy itself before it is worth
  // reading as an edge at all.
  const real = Math.abs(edgePts) > (accuracy.marginPct ?? 99);

  const verdict =
    !real
      ? `${accuracy.pct}% vs a ${basePct}% base rate — inside the noise, no demonstrated edge`
      : edgePts > 0
        ? `${accuracy.pct}% vs a ${basePct}% base rate — ${edgePts} points of edge`
        : `${accuracy.pct}% vs a ${basePct}% base rate — ${Math.abs(edgePts)} points WORSE than guessing`;

  return { accuracy, basePct, edgePts, real, verdict };
}

/** A named slice, for the breakdown table. */
export interface EdgeSegment {
  key: string;
  label: string;
  result: EdgeResult;
}

/**
 * The segments that actually moved on this book. Deliberately a short list —
 * slicing a 517-case sample twenty ways guarantees something looks impressive
 * by luck, and the whole point of this module is to stop reading luck as skill.
 */
export function engineSegments(rows: EdgeRow[]): EdgeSegment[] {
  const base = baseRates(rows);
  const seg = (key: string, label: string, subset: EdgeRow[], dir: "accum" | "distrib" | "both") =>
    ({ key, label, result: edgeFor(subset, base, dir) });

  return [
    seg("all", "Every call", rows, "both"),
    seg("accum", "When it says ACCUM", rows, "accum"),
    seg("distrib", "When it says DISTRIB", rows, "distrib"),
    seg("spring", "After a spring", rows.filter((r) => r.terminalTest === "spring"), "both"),
    seg("upthrust", "After an upthrust", rows.filter((r) => r.terminalTest === "upthrust"), "both"),
    seg("no-test", "With no terminal test", rows.filter((r) => r.terminalTest === "none"), "both"),
  ];
}

/**
 * The engine's record on calls like THIS one — what belongs next to a live
 * verdict. A verdict with no track record attached is an opinion presented as
 * information, which is exactly how 56% came to sit on the page unchallenged.
 */
export function recordForCall(
  rows: EdgeRow[],
  verdict: string | null,
  terminalTest: string | null | undefined,
): EdgeResult | null {
  if (verdict !== "accum" && verdict !== "distrib") return null;
  const base = baseRates(rows);
  // Prefer the narrower, more relevant slice, but only when it has the sample
  // to support it — otherwise fall back to all calls of this direction.
  const withTest = rows.filter((r) => r.terminalTest === terminalTest);
  const narrow = edgeFor(withTest, base, verdict);
  return narrow.accuracy.confidence === "solid" ? narrow : edgeFor(rows, base, verdict);
}
