// tests/engine.test.ts — the detector, against bars built on purpose.
//
// engine.ts opens by claiming every function is pure "so the whole engine is
// unit-testable against synthetic bars". It had no tests. These are those bars.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanBars, detectRanges, contextPct, lastSpring, lastUpthrust, terminalTest,
  engineVerdict, outcome, outcomeReady, freshReason, pressingBoundary, CFG, type Bar,
} from "../lib/wyckoff/engine";

const bar = (o: number, h: number, l: number, c: number, v: number, date: string): Bar =>
  ({ o, h, l, c, v, date });

/** N bars oscillating inside [lo,hi], touching both edges — a textbook range. */
function box(n: number, lo: number, hi: number, startDay = 1, vol = 1000): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const atTop = i % 2 === 0;
    const d = `2026-01-${String(startDay + i).padStart(2, "0")}`;
    out.push(atTop ? bar(lo + 1, hi, lo + 0.5, hi - 0.5, vol, d)
                   : bar(hi - 1, hi - 0.5, lo, lo + 0.5, vol, d));
  }
  return out;
}

const isoDays = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1 + from + i)).toISOString().slice(0, 10));

test("cleanBars drops anything unusable, including zero volume", () => {
  const bars = [
    bar(1, 2, 0.5, 1.5, 100, "2026-01-01"),
    bar(1, 2, 0.5, 1.5, 0, "2026-01-02"),          // zero volume
    bar(NaN, 2, 0.5, 1.5, 100, "2026-01-03"),      // NaN
  ];
  assert.equal(cleanBars(bars).length, 1);
});

test("a clean consolidation is detected as one open range", () => {
  const bars = box(30, 100, 110);
  const ranges = detectRanges(bars);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].status, "open", "no breakout in the data, so it is still open");
  assert.ok(ranges[0].touchesHi >= 2 && ranges[0].touchesLo >= 2);
});

test("a close outside the band ends the range; a wick through it does not", () => {
  const days = isoDays(40);
  const inBox = box(30, 100, 110).map((b, i) => ({ ...b, date: days[i] }));

  // A wick well above the ceiling that closes back inside — a test, not a break.
  const wick = [...inBox, bar(109, 130, 108, 105, 1000, days[30])];
  assert.equal(detectRanges(wick)[0].status, "open", "a wick through the ceiling is a test");

  // A close above the tolerance band — a genuine break.
  const broke = [...inBox, bar(109, 130, 108, 128, 1000, days[30]),
                 ...isoDays(9, 31).map((d) => bar(128, 130, 127, 129, 1000, d))];
  assert.equal(detectRanges(broke)[0].status, "broken");
});

test("a band wider than MAXBAND is not a range", () => {
  // 100–200 around a mid of 150 is a 67% band, far past the 28% cap.
  assert.equal(detectRanges(box(30, 100, 200)).length, 0);
});

test("springs and upthrusts are the LAST such bar, not the first", () => {
  const days = isoDays(12);
  const bars: Bar[] = [
    ...box(4, 100, 110).map((b, i) => ({ ...b, date: days[i] })),
    bar(101, 105, 96, 101, 1000, days[4]),   // spring #1
    ...box(3, 100, 110).map((b, i) => ({ ...b, date: days[5 + i] })),
    bar(101, 105, 97, 102, 1000, days[8]),   // spring #2 — the terminal one
    ...box(3, 100, 110).map((b, i) => ({ ...b, date: days[9 + i] })),
  ];
  assert.equal(lastSpring(bars, 0, bars.length, 100), 8);
  assert.equal(lastUpthrust(bars, 0, bars.length, 110), null);
  assert.equal(terminalTest(8, null), "spring");
  assert.equal(terminalTest(8, 3), "both");
  assert.equal(terminalTest(null, null), "none");
});

test("engineVerdict reads effort against result, in both directions", () => {
  const days = isoDays(20);
  // Up moves cost heavy volume per point; down moves are cheap => supply => distrib.
  const distrib: Bar[] = [];
  for (let i = 0; i < 20; i++) {
    const up = i % 2 === 0;
    distrib.push(bar(100, 101, 99, up ? 100.5 : 100, up ? 9000 : 500, days[i]));
  }
  assert.equal(engineVerdict(distrib, 0, distrib.length), "distrib");

  // Mirror it: down moves expensive => demand => accum.
  const accum: Bar[] = [];
  for (let i = 0; i < 20; i++) {
    const up = i % 2 === 0;
    accum.push(bar(100, 101, 99, up ? 100.5 : 100, up ? 500 : 9000, days[i]));
  }
  assert.equal(engineVerdict(accum, 0, accum.length), "accum");
});

test("engineVerdict is neutral when a direction never happens", () => {
  const days = isoDays(5);
  const flat = days.map((d) => bar(100, 100, 100, 100, 1000, d));
  assert.equal(engineVerdict(flat, 0, flat.length), "neutral");
});

test("outcome reads the bar RESOLVE_BARS after the range ended", () => {
  const n = 40;
  const days = isoDays(n);
  const bars = days.map((d) => bar(100, 101, 99, 100, 1000, d));
  const end = 20;
  bars[end + CFG.RESOLVE_BARS] = bar(100, 130, 99, 130, 1000, days[end + CFG.RESOLVE_BARS]);
  assert.equal(outcome(bars, end, 100, 110), "up");
  bars[end + CFG.RESOLVE_BARS] = bar(100, 101, 50, 50, 1000, days[end + CFG.RESOLVE_BARS]);
  assert.equal(outcome(bars, end, 100, 110), "down");
  bars[end + CFG.RESOLVE_BARS] = bar(100, 106, 104, 105, 1000, days[end + CFG.RESOLVE_BARS]);
  assert.equal(outcome(bars, end, 100, 110), "chop");
});

test("outcomeReady gates on having enough forward bars", () => {
  assert.equal(outcomeReady(30, 20), false);          // needs 20 + 12
  assert.equal(outcomeReady(33, 20), true);
});

test("contextPct needs real history before the range", () => {
  const bars = isoDays(CFG.CONTEXT_BARS + 10).map((d) => bar(100, 101, 99, 100, 1000, d));
  assert.equal(contextPct(bars, 10), null, "not enough bars before the start");
  assert.equal(contextPct(bars, CFG.CONTEXT_BARS), 0);
});

test("freshness names WHY a range is at a decision point", () => {
  const bars = box(30, 100, 110);
  const range = detectRanges(bars)[0];
  // Last bar sits on a boundary by construction.
  assert.equal(pressingBoundary(bars, range), true);
  assert.equal(freshReason(bars, range, null, null), "pressing-boundary");
  // A test that printed near the end outranks merely pressing the edge.
  assert.equal(freshReason(bars, range, bars.length - 1, null), "test-printed");
});
