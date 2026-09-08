// tests/identity.test.ts — the clone bug must never come back.
//
// assignRanges once filtered settled rows out of matching, on the reasoning
// that a row holding evidence must not be rewritten. True, but "never rewrite
// it" and "never match it" are different instructions, and taking the second
// meant every already-broken range failed to find its own row and created a new
// one instead. ~785 clones per scan; 9,304 of 10,485 rows by the time anyone
// looked. Each clone then resolved on its own and posted a months-old success
// or failure to the monthly audit as though it had just happened.
//
// The first test below is the one that would have caught it on day one.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignRanges, spanOverlapDays, timeOverlapFraction, priceOverlapFraction,
  type ExistingRow,
} from "../lib/wyckoff/identity";

const span = (startDate: string, endDate: string, lo: number, hi: number) =>
  ({ startDate, endDate, lo, hi });

test("a settled row still claims its own re-detection — the clone bug", () => {
  // A range that broke out. Its row is settled: boundaries final, verdict
  // locked. The detector re-finds it on every subsequent scan because it is
  // still sitting in the bars.
  const existing: ExistingRow[] = [
    { id: "settled-row", ...span("2026-01-05", "2026-02-10", 100, 110), frozen: true },
  ];
  const detected = [span("2026-01-05", "2026-02-10", 100, 110)];

  const [a] = assignRanges(detected, existing);

  assert.equal(a.matchedId, "settled-row", "must match, or a duplicate row gets created");
  assert.equal(a.frozen, true, "and must be flagged so the caller writes nothing to it");
});

test("a settled match is never reported as a re-anchor", () => {
  // A settled row's start date is final, so a drifting detector is not an
  // event worth recording against it.
  const existing: ExistingRow[] = [
    { id: "settled", ...span("2026-01-05", "2026-02-10", 100, 110), frozen: true },
  ];
  const [a] = assignRanges([span("2026-01-06", "2026-02-10", 100, 110)], existing);
  assert.equal(a.matchedId, "settled");
  assert.equal(a.reanchored, false);
});

test("an open row re-anchored by one bar keeps its row", () => {
  // The original reason identity.ts exists: fetchDailyBars returns a rolling
  // window, so the greedy detector re-anchors a start date and the same setup
  // used to fork into a new row.
  const existing: ExistingRow[] = [
    { id: "open-row", ...span("2026-01-05", "2026-03-01", 100, 110) },
  ];
  const [a] = assignRanges([span("2026-01-06", "2026-03-02", 100.2, 110.1)], existing);
  assert.equal(a.matchedId, "open-row");
  assert.equal(a.reanchored, true, "the start date moved, and that is worth recording");
});

test("a genuinely new range at different prices does not steal an existing row", () => {
  const existing: ExistingRow[] = [
    { id: "low-box", ...span("2026-01-05", "2026-02-10", 100, 110) },
  ];
  // Same weeks, completely different price area — a different setup.
  const [a] = assignRanges([span("2026-01-05", "2026-02-10", 200, 220)], existing);
  assert.equal(a.matchedId, null);
});

test("a box at the same prices years later is not the same range", () => {
  const existing: ExistingRow[] = [
    { id: "old", ...span("2024-01-05", "2024-02-10", 100, 110) },
  ];
  const [a] = assignRanges([span("2026-01-05", "2026-02-10", 100, 110)], existing);
  assert.equal(a.matchedId, null, "no time overlap, so not the same range");
});

test("assignment is one-to-one — two detections cannot claim one row", () => {
  const existing: ExistingRow[] = [
    { id: "only-row", ...span("2026-01-05", "2026-02-10", 100, 110) },
  ];
  const out = assignRanges(
    [span("2026-01-05", "2026-02-10", 100, 110), span("2026-01-06", "2026-02-09", 100.5, 109.5)],
    existing,
  );
  const claimed = out.filter((a) => a.matchedId === "only-row");
  assert.equal(claimed.length, 1, "the other must be created, not silently overwrite the first");
});

test("overlap measures behave at the edges", () => {
  assert.equal(spanOverlapDays(span("2026-01-01", "2026-01-10", 0, 1), span("2026-01-20", "2026-01-30", 0, 1)), 0);
  assert.equal(timeOverlapFraction(span("2026-01-01", "2026-01-10", 0, 1), span("2026-01-01", "2026-01-10", 0, 1)), 1);
  // A box fully inside a wider one shares all of the NARROWER band.
  assert.equal(priceOverlapFraction(span("2026-01-01", "2026-01-10", 100, 110), span("2026-01-01", "2026-01-10", 90, 120)), 1);
  assert.equal(priceOverlapFraction(span("2026-01-01", "2026-01-10", 100, 110), span("2026-01-01", "2026-01-10", 200, 210)), 0);
});
