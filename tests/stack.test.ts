// tests/stack.test.ts — one area pressed repeatedly is one card, not several.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStacks, stackCandidates, pickFront, bandOverlap } from "../lib/wyckoff/stack";

const row = (id: string, lo: number, hi: number, extra: Record<string, unknown> = {}) =>
  ({ id, instrument: "PG", rangeLo: lo, rangeHi: hi, ...extra }) as any;

test("overlapping boxes on one pair collapse into a single stack", () => {
  // The real PG case: identical ceiling, floors three days apart.
  const stacks = buildStacks([row("a", 141.8, 153.02), row("b", 144.53, 153.02)]);
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0].rows.length, 2);
  assert.equal(stacks[0].stacked, true);
});

test("boxes at genuinely different prices stay separate", () => {
  const stacks = buildStacks([row("a", 100, 110), row("b", 200, 210)]);
  assert.equal(stacks.length, 2);
  assert.equal(stacks[0].stacked, false);
});

test("stacking is transitive — A~B and B~C is one pile", () => {
  // Chained overlap: the ends barely touch, but all three press one area, and
  // splitting on a threshold technicality would put two cards on the desk for
  // one region of the chart.
  const stacks = buildStacks([row("a", 100, 110), row("b", 105, 115), row("c", 110, 120)]);
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0].rows.length, 3);
});

test("a box you acted on fronts the pile, over a better-graded one", () => {
  const front = pickFront([
    row("untouched", 100, 110, { gradeScore: 95 }),
    row("read", 101, 111, { gradeScore: 20, traderVerdict: "accum" }),
  ]);
  assert.equal(front.id, "read", "your read is the most specific thing known about the area");
});

test("failing a read, the better grade fronts; failing that, the open one", () => {
  assert.equal(pickFront([row("a", 100, 110, { gradeScore: 30 }), row("b", 101, 111, { gradeScore: 80 })]).id, "b");
  assert.equal(
    pickFront([row("a", 100, 110, { status: "broken" }), row("b", 101, 111, { status: "open" })]).id,
    "b",
    "an open range is still tradeable; a broken one is a retest at best",
  );
});

test("a watched box outranks an untouched one but yields to a read", () => {
  assert.equal(
    pickFront([
      row("watched", 100, 110, { watch: "now", gradeScore: 10 }),
      row("read", 101, 111, { traderVerdict: "distrib", gradeScore: 10 }),
    ]).id,
    "read",
  );
});

test("stackCandidates preserves the incoming rank order across instruments", () => {
  const rows = [
    { ...row("x", 100, 110), instrument: "AAA" },
    { ...row("y", 200, 210), instrument: "BBB" },
    { ...row("z", 101, 111), instrument: "AAA" },
  ];
  const stacks = stackCandidates(rows as any);
  assert.equal(stacks[0].instrument, "AAA", "first appearance fixes the position");
  assert.equal(stacks[0].rows.length, 2);
  assert.equal(stacks[1].instrument, "BBB");
});

test("bandOverlap measures the share of the NARROWER box", () => {
  assert.equal(bandOverlap(row("a", 100, 110), row("b", 90, 120)), 1);
  assert.equal(bandOverlap(row("a", 100, 110), row("b", 111, 120)), 0);
});

test("sightings sum across the whole pile", () => {
  const [s] = buildStacks([
    row("a", 100, 110, { sightingCount: 3 }),
    row("b", 101, 111, { sightingCount: 4 }),
  ]);
  assert.equal(s.sightings, 7, "how many times this AREA asked for an answer");
});
