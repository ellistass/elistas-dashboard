// lib/wyckoff/stack.ts — when one pair keeps offering the same area.
//
// The desk used to show these as loose cards scattered through a grid sorted by
// grade, which framed them as separate opportunities. They are not. CAC showing
// 8409–8755 and 8278–8669 is one index pressing one area twice; PG showing
// 141.80–153.02 and 144.53–153.02 — identical ceiling, floors three days apart —
// is one range the detector anchored two different ways.
//
// Grouping them under the pair (which the desk already does) was half the fix
// and framed it wrong: it made repetition look like clutter to be tidied away.
// It is the opposite. A range that keeps coming back to its edge is a range
// under pressure, and the count of times it has done so is one of the few
// genuinely predictive things on the card. So they STACK: one card fronting the
// pile, the depth stated, and the whole pile readable in the drawer.
//
// A stack is a set of UNRESOLVED candidates on one instrument whose price bands
// overlap. Price overlap, not time: two boxes at the same levels months apart
// are the same area being retested, which is exactly the thing worth seeing.
// Two boxes at different prices in the same week are genuinely different setups
// and stay separate cards.

export interface StackableRow {
  id: string;
  instrument: string;
  rangeLo: number;
  rangeHi: number;
  status?: string | null;
  grade?: string | null;
  gradeScore?: number | null;
  surfacedBarDate?: string | null;
  firstSeenBarDate?: string | null;
  sightingCount?: number | null;
  traderVerdict?: string | null;
  watch?: string | null;
}

/** Share of the narrower band that two boxes share. Same measure identity.ts
 *  uses for the price axis, so "overlapping" means one thing system-wide. */
export function bandOverlap(a: StackableRow, b: StackableRow): number {
  const aBand = Math.abs(a.rangeHi - a.rangeLo);
  const bBand = Math.abs(b.rangeHi - b.rangeLo);
  const narrower = Math.min(aBand, bBand);
  if (narrower <= 0) return 0;
  const from = Math.max(Math.min(a.rangeLo, a.rangeHi), Math.min(b.rangeLo, b.rangeHi));
  const to = Math.min(Math.max(a.rangeLo, a.rangeHi), Math.max(b.rangeLo, b.rangeHi));
  return to <= from ? 0 : (to - from) / narrower;
}

/** How much two boxes must share to count as the same area. Lower than
 *  identity.ts's 0.6 match gate on purpose: identity is deciding whether to
 *  OVERWRITE a row and must be conservative, while stacking only decides what
 *  to draw next to what, where a near miss costs nothing. */
export const MIN_STACK_OVERLAP = 0.35;

export interface Stack<T extends StackableRow> {
  instrument: string;
  /** The card that fronts the pile — see pickFront. */
  front: T;
  /** Everything in the stack, front first. */
  rows: T[];
  /** Total decision-point sightings across the whole stack: how many separate
   *  times this area has asked for an answer. */
  sightings: number;
  /** Earliest date anything in the stack reached a decision point. */
  firstSeen: string | null;
  /** True once there is more than one box in the pile. */
  stacked: boolean;
}

const earliest = (rows: StackableRow[]): string | null => {
  const d = rows
    .flatMap((r) => [r.surfacedBarDate, r.firstSeenBarDate])
    .filter((x): x is string => !!x)
    .map((x) => x.slice(0, 10));
  return d.length ? d.sort()[0] : null;
};

/**
 * Which box speaks for the pile.
 *
 * A box you have already committed to fronts it — your read is the most
 * specific thing anyone knows about that area, and burying it under a
 * higher-graded box you have never looked at would be backwards. Failing that,
 * the best structural grade; failing that, the one still open, since an open
 * range is still tradeable and a broken one is a retest at best.
 */
export function pickFront<T extends StackableRow>(rows: T[]): T {
  return [...rows].sort((a, b) => {
    const acted = (b.traderVerdict ? 2 : b.watch ? 1 : 0) - (a.traderVerdict ? 2 : a.watch ? 1 : 0);
    if (acted !== 0) return acted;
    const g = (b.gradeScore ?? 50) - (a.gradeScore ?? 50);
    if (g !== 0) return g;
    return (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1);
  })[0];
}

/**
 * Collapse one instrument's candidates into stacks of overlapping boxes.
 *
 * Transitive by construction: A overlaps B and B overlaps C puts all three in
 * one pile even if A and C barely touch. That is the right reading — they are
 * all pressing the same area, and splitting on a threshold technicality would
 * put two cards on the desk for one region of the chart.
 */
export function buildStacks<T extends StackableRow>(rows: T[]): Array<Stack<T>> {
  const stacks: T[][] = [];
  for (const row of rows) {
    const hit = stacks.find((s) => s.some((m) => bandOverlap(m, row) >= MIN_STACK_OVERLAP));
    if (hit) hit.push(row);
    else stacks.push([row]);
  }
  return stacks.map((rows) => {
    const front = pickFront(rows);
    const ordered = [front, ...rows.filter((r) => r !== front)];
    return {
      instrument: front.instrument,
      front,
      rows: ordered,
      sightings: rows.reduce((s, r) => s + (r.sightingCount ?? 0), 0),
      firstSeen: earliest(rows),
      stacked: rows.length > 1,
    };
  });
}

/** Every stack across every instrument, preserving the incoming rank order:
 *  the first appearance of an instrument fixes where its stacks sit. */
export function stackCandidates<T extends StackableRow>(rows: T[]): Array<Stack<T>> {
  const order: string[] = [];
  const byInstrument = new Map<string, T[]>();
  for (const r of rows) {
    if (!byInstrument.has(r.instrument)) { byInstrument.set(r.instrument, []); order.push(r.instrument); }
    byInstrument.get(r.instrument)!.push(r);
  }
  return order.flatMap((i) => buildStacks(byInstrument.get(i)!));
}
