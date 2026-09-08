// tests/entry.test.ts — the two ways in, and the blind that guards them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { entryPlans, findTestBar } from "../lib/wyckoff/entry";

const LO = 100, HI = 110;

test("no direction means no plans — the card stays neutral", () => {
  // This is the blind, not a nicety: pricing an entry before a side is chosen
  // would hand over the answer to the question the desk is asking.
  assert.equal(entryPlans({ rangeLo: LO, rangeHi: HI, verdict: null, status: "open" }).length, 0);
  assert.equal(entryPlans({ rangeLo: LO, rangeHi: HI, verdict: "pass", status: "open" }).length, 0);
  assert.equal(entryPlans({ rangeLo: LO, rangeHi: HI, verdict: "neutral", status: "open" }).length, 0);
});

test("a degenerate box yields nothing rather than dividing by zero", () => {
  assert.equal(entryPlans({ rangeLo: 100, rangeHi: 100, verdict: "accum", status: "open" }).length, 0);
});

test("long: aggressive buys the floor, conservative buys the retest", () => {
  const [agg, cons] = entryPlans({
    rangeLo: LO, rangeHi: HI, verdict: "accum", status: "open", testBar: { h: 109, l: 98 },
  });
  assert.equal(agg.direction, "long");
  assert.ok(agg.entry > LO && agg.entry < HI, "entry sits inside the box, in the floor zone");
  assert.ok(agg.stop < 98, "stop clears the spring's own wick");
  assert.equal(cons.entry, HI, "the retest is the broken ceiling");
  assert.ok(cons.stop < HI && cons.stop > LO, "back inside the box invalidates the break");
  assert.equal(agg.target2, HI + (HI - LO), "measured move is one range height");
});

test("short mirrors long exactly", () => {
  const [agg, cons] = entryPlans({
    rangeLo: LO, rangeHi: HI, verdict: "distrib", status: "broken", testBar: { h: 112, l: 101 },
  });
  assert.equal(agg.direction, "short");
  assert.ok(agg.stop > 112, "stop clears the upthrust's wick");
  assert.equal(cons.entry, LO);
  assert.equal(agg.target2, LO - (HI - LO));
});

test("aggressive beats conservative on reward-to-risk — that is the trade-off", () => {
  const [agg, cons] = entryPlans({
    rangeLo: LO, rangeHi: HI, verdict: "accum", status: "open", testBar: { h: 109, l: 98 },
  });
  assert.ok(agg.rr! > cons.rr!, "the tighter stop is the whole reason to be early");
});

test("availability follows the range's actual state", () => {
  const open = entryPlans({ rangeLo: LO, rangeHi: HI, verdict: "accum", status: "open" });
  assert.equal(open[0].available, true, "you can still buy the floor while it is a floor");
  assert.equal(open[1].available, false, "nothing has broken, so nothing can retest");

  const broken = entryPlans({ rangeLo: LO, rangeHi: HI, verdict: "accum", status: "broken" });
  assert.equal(broken[0].available, false, "the floor is behind price now");
  assert.equal(broken[1].available, true);
  assert.match(broken[0].pending ?? "", /behind price/);
});

test("with no terminal test the stop comes off the boundary, and says so", () => {
  const [agg] = entryPlans({ rangeLo: LO, rangeHi: HI, verdict: "accum", status: "open", testBar: null });
  assert.ok(agg.stop < LO, "still below the floor");
  assert.match(agg.note, /No terminal test/);
});

test("findTestBar locates the bar by date in the packed spark tuples", () => {
  const spark = [
    [1, 2, 0.5, 1.5, 100, "2026-01-01"],
    [1, 9, 0.25, 1.5, 100, "2026-01-02"],
  ];
  assert.deepEqual(findTestBar(spark, "2026-01-02"), { h: 9, l: 0.25 });
  assert.equal(findTestBar(spark, "2026-01-09"), null);
  assert.equal(findTestBar(null, "2026-01-02"), null);
  assert.equal(findTestBar(spark, null), null);
});
