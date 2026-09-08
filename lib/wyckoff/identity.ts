// lib/wyckoff/identity.ts — deciding whether a detected range is one we have
// already been tracking.
//
// THE BUG THIS FIXES
// A candidate row was keyed `instrument + rangeStartDate`. That looks stable
// and is not. `fetchDailyBars` pulls a ROLLING window, so every scan sees a
// series with a different first bar, and `detectRanges` is greedy and
// order-dependent — it walks from index 0 and jumps `i = e + 1` past each hit.
// Move the start of the series and the whole downstream chain of boundaries can
// shift with it.
//
// Consequence: the same consolidation you looked at yesterday gets re-detected
// today anchored one bar earlier. Different key, so it became a DIFFERENT ROW —
// yesterday's row orphaned, today's row claiming a first-seen date that should
// have been yesterday's, and every count built on top of that moving underneath
// the percentage.
//
// THE FIX
// Stop using a derived value as identity. A range is the same range if it
// covers the same stretch of time at the same price — so match on OVERLAP, and
// let `rangeStartDate` be a corrigible estimate rather than a name.
//
// Fail-safe direction: when in doubt, do NOT match. A missed match creates a
// duplicate you can see and merge. A wrong match silently rewrites the history
// of a setup you already read — which is the thing being protected.

export interface RangeSpan {
  /** YYYY-MM-DD of the first bar. */
  startDate: string;
  /** YYYY-MM-DD of the breakout bar, or of the latest bar while still open. */
  endDate: string;
  lo: number;
  hi: number;
}

export interface ExistingRow extends RangeSpan {
  id: string;
  /** Settled rows: the range broke out, or its outcome is already recorded.
   *  Nothing about them may be rewritten — but they MUST still take part in
   *  matching. See the note above assignRanges: excluding them was the bug. */
  frozen?: boolean;
}

const DAY = 86_400_000;
const t = (d: string): number => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

/** Calendar days two spans share. Calendar rather than trading days is fine
 *  here: both spans come from the same series, so weekends cancel out. */
export function spanOverlapDays(a: RangeSpan, b: RangeSpan): number {
  const from = Math.max(t(a.startDate), t(b.startDate));
  const to = Math.min(t(a.endDate), t(b.endDate));
  return to < from ? 0 : (to - from) / DAY + 1;
}

export function spanDays(s: RangeSpan): number {
  return Math.max(1, (t(s.endDate) - t(s.startDate)) / DAY + 1);
}

/** Share of the SHORTER span that overlaps. Using the shorter one means a range
 *  that has simply grown longer still recognises itself — which is the normal
 *  case for an open range gaining bars every day. */
export function timeOverlapFraction(a: RangeSpan, b: RangeSpan): number {
  const shorter = Math.min(spanDays(a), spanDays(b));
  return shorter <= 0 ? 0 : spanOverlapDays(a, b) / shorter;
}

/** Share of the NARROWER price box that the two boxes share. */
export function priceOverlapFraction(a: RangeSpan, b: RangeSpan): number {
  const aBand = Math.abs(a.hi - a.lo);
  const bBand = Math.abs(b.hi - b.lo);
  const narrower = Math.min(aBand, bBand);
  if (narrower <= 0) return 0;
  const from = Math.max(Math.min(a.lo, a.hi), Math.min(b.lo, b.hi));
  const to = Math.min(Math.max(a.lo, a.hi), Math.max(b.lo, b.hi));
  return to <= from ? 0 : (to - from) / narrower;
}

// Both gates must pass. Two ranges can share a lot of calendar and be at
// completely different prices (a box that broke and reformed higher), or share
// a price band and be years apart. Neither is the same setup.
export const MIN_TIME_OVERLAP = 0.6;
export const MIN_PRICE_OVERLAP = 0.6;

export interface MatchScore {
  time: number;
  price: number;
  /** Product — a candidate strong on both beats one that is excellent on a
   *  single axis and marginal on the other. */
  score: number;
}

export function scoreMatch(a: RangeSpan, b: RangeSpan): MatchScore {
  const time = timeOverlapFraction(a, b);
  const price = priceOverlapFraction(a, b);
  return { time, price, score: time * price };
}

export interface Assignment<T extends RangeSpan> {
  detected: T;
  /** null = genuinely new, create a row. */
  matchedId: string | null;
  score: number;
  /** True when the match moved the range's start date — the re-anchor event
   *  that used to fork a new row and lose the original first-seen date. */
  reanchored: boolean;
  /** The matched row is settled: it has claimed this detection (so no clone is
   *  created) but the caller must not write to it. */
  frozen: boolean;
}

/**
 * Assign every detected range to an existing row, or to nothing.
 *
 * Greedy over the best scores globally, one-to-one: without that, two detected
 * ranges can both claim the same row and one silently overwrites the other.
 *
 * SETTLED ROWS MATCH TOO — and this is the whole point.
 *
 * The first version of this function filtered them out (`existing.filter(e =>
 * !e.frozen)`) on the reasoning that a row holding a locked read or a recorded
 * outcome is evidence and must never be rewritten. True — but "never rewrite
 * it" and "never match it" are different instructions, and taking the second
 * one produced the opposite of what it was protecting.
 *
 * A range that has already broken out is STILL IN THE BARS. Every scan
 * re-detects it, finds nothing to match (its row was hidden), and creates a
 * brand-new row. Then the outcome backfill resolves that row, and a success or
 * a failure that already happened months ago lands in the audit as if it were
 * new. Measured on the live table: ~785 clone rows per scan, 9,304 of 10,485
 * rows — one setup logged thirteen separate times, with the original (the copy
 * carrying the trader's read, note and alert) orphaned behind twelve blanks.
 *
 * So: match everything, and hand the caller a `frozen` flag to decide what may
 * be written. Claiming the detection is what stops the clone; the flag is what
 * protects the evidence.
 */
export function assignRanges<T extends RangeSpan>(
  detected: T[],
  existing: ExistingRow[],
): Array<Assignment<T>> {
  const pairs: Array<{ di: number; ei: number; score: number }> = [];
  detected.forEach((d, di) => {
    existing.forEach((e, ei) => {
      const m = scoreMatch(d, e);
      if (m.time >= MIN_TIME_OVERLAP && m.price >= MIN_PRICE_OVERLAP) {
        pairs.push({ di, ei, score: m.score });
      }
    });
  });
  // Best score first; a settled row breaks a tie, because the older evidence
  // has the better claim on a detection two rows fit equally well.
  pairs.sort((x, y) => y.score - x.score || Number(!!existing[y.ei].frozen) - Number(!!existing[x.ei].frozen));

  const takenD = new Set<number>();
  const takenE = new Set<number>();
  const result = new Map<number, { id: string; score: number; frozen: boolean }>();
  for (const p of pairs) {
    if (takenD.has(p.di) || takenE.has(p.ei)) continue;
    takenD.add(p.di);
    takenE.add(p.ei);
    result.set(p.di, { id: existing[p.ei].id, score: p.score, frozen: !!existing[p.ei].frozen });
  }

  return detected.map((d, di) => {
    const hit = result.get(di);
    if (!hit) return { detected: d, matchedId: null, score: 0, reanchored: false, frozen: false };
    const row = existing.find((e) => e.id === hit.id)!;
    return {
      detected: d,
      matchedId: hit.id,
      score: hit.score,
      // A settled row's start date is final, so a "re-anchor" against one is
      // not an event to record — it is just the detector drifting.
      reanchored: !hit.frozen && row.startDate.slice(0, 10) !== d.startDate.slice(0, 10),
      frozen: hit.frozen,
    };
  });
}
