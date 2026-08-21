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
  /** Rows with a locked read or an outcome are frozen and must never be
   *  re-matched — their boundaries are evidence, not estimates. */
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
}

/**
 * Assign every detected range to an existing row, or to nothing.
 *
 * Greedy over the best scores globally, one-to-one: without that, two detected
 * ranges can both claim the same row and one silently overwrites the other.
 */
export function assignRanges<T extends RangeSpan>(
  detected: T[],
  existing: ExistingRow[],
): Array<Assignment<T>> {
  const open = existing.filter((e) => !e.frozen);

  const pairs: Array<{ di: number; ei: number; score: number }> = [];
  detected.forEach((d, di) => {
    open.forEach((e, ei) => {
      const m = scoreMatch(d, e);
      if (m.time >= MIN_TIME_OVERLAP && m.price >= MIN_PRICE_OVERLAP) {
        pairs.push({ di, ei, score: m.score });
      }
    });
  });
  pairs.sort((x, y) => y.score - x.score);

  const takenD = new Set<number>();
  const takenE = new Set<number>();
  const result = new Map<number, { id: string; score: number }>();
  for (const p of pairs) {
    if (takenD.has(p.di) || takenE.has(p.ei)) continue;
    takenD.add(p.di);
    takenE.add(p.ei);
    result.set(p.di, { id: open[p.ei].id, score: p.score });
  }

  return detected.map((d, di) => {
    const hit = result.get(di);
    if (!hit) return { detected: d, matchedId: null, score: 0, reanchored: false };
    const row = open.find((e) => e.id === hit.id)!;
    return {
      detected: d,
      matchedId: hit.id,
      score: hit.score,
      reanchored: row.startDate.slice(0, 10) !== d.startDate.slice(0, 10),
    };
  });
}
