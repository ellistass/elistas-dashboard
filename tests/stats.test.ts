// tests/stats.test.ts — a percentage must never render without its sample.
//
// The strategy scoreboard reported a win rate on 2 of 759 trades, at 22px,
// beside metrics built on hundreds. rate() makes that shape unrenderable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rate, compareRates, coverage, MIN_RATE_N, SOLID_RATE_N } from "../lib/stats";

test("below the floor there is no percentage at all", () => {
  const r = rate(1, 2);
  assert.equal(r.pct, null, "a null pct cannot be accidentally rendered as a number");
  assert.equal(r.label, "1 of 2");
  assert.equal(r.confidence, "none");
});

test("between the floor and solid, a rate is provisional", () => {
  const r = rate(8, 14);
  assert.equal(r.pct, 57);
  assert.equal(r.confidence, "provisional");
  assert.ok((r.marginPct ?? 0) > 20, "14 cases cannot pin a proportion tighter than ±20");
});

test("a large sample reports solid with a tight margin", () => {
  const r = rate(288, 517);
  assert.equal(r.confidence, "solid");
  assert.ok((r.marginPct ?? 99) <= 5);
});

test("empty and degenerate inputs never throw or lie", () => {
  assert.equal(rate(0, 0).label, "—");
  assert.equal(rate(0, 0).pct, null);
  assert.equal(rate(5, -1).pct, null);
  assert.equal(rate(NaN, 10).pct, null);
});

test("boundaries land on the right side", () => {
  assert.equal(rate(5, MIN_RATE_N - 1).confidence, "none");
  assert.equal(rate(5, MIN_RATE_N).confidence, "provisional");
  assert.equal(rate(15, SOLID_RATE_N).confidence, "solid");
});

test("a gap inside the noise is not reported as a difference", () => {
  // The live duel: you 8/14, engine 9/14.
  const c = compareRates(rate(8, 14), rate(9, 14));
  assert.equal(c.meaningful, false);
  assert.match(c.note, /inside the noise/);
});

test("a real gap on a big sample is reported as one", () => {
  const c = compareRates(rate(288, 517), rate(200, 517));
  assert.equal(c.meaningful, true);
});

test("coverage flags a field most rows lack", () => {
  const c = coverage(2, 759);
  assert.equal(c.usable, false);
  assert.match(c.note ?? "", /describes those 2/);
  assert.equal(coverage(495, 759).note, null, "two thirds coverage needs no warning");
});
