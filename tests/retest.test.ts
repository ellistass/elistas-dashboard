// tests/retest.test.ts — an LPS and a failing breakout look identical on price.
//
// The whole module exists because geometry cannot separate them: both are
// "price came back to the broken edge". Only volume and spread can, and these
// tests pin the two apart on synthetic bars where the answer is known.

import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeRetest, SOS_VOLUME, LPS_VOLUME } from "../lib/wyckoff/retest";
import type { Bar } from "../lib/wyckoff/engine";

const b = (h: number, l: number, c: number, v: number, d: string): Bar =>
  ({ o: (h + l) / 2, h, l, c, v, date: d });

const day = (i: number) => `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`;

/** 20 quiet bars inside 100–110: avg volume 1000, avg spread 2. */
const range = (): Bar[] => Array.from({ length: 20 }, (_, i) => b(109, 107, 108, 1000, day(i)));

const LO = 100, HI = 110;

test("a real LPS: effort out, no effort back", () => {
  const bars = [
    ...range(),
    b(116, 110, 115, 1600, day(20)),   // SOS: 1.6x volume, 3.0x spread, closes well above
    b(115, 112, 114, 900, day(21)),
    b(111.4, 110.2, 111, 700, day(22)), // LPS: 0.7x volume, 0.6x spread, returns to the edge and holds
  ];
  const g = gradeRetest({ bars, start: 0, end: 20, rangeLo: LO, rangeHi: HI, up: true });
  assert.equal(g.verdict, "lps");
  assert.equal(g.confirmed, true);
  assert.equal(g.warning, false);
  assert.ok((g.retestVolumeX ?? 9) <= LPS_VOLUME);
});

test("the same shape on rising volume is the break being sold into", () => {
  const bars = [
    ...range(),
    b(116, 110, 115, 1600, day(20)),   // identical SOS
    b(115, 112, 114, 900, day(21)),
    b(114, 109.5, 110.5, 1900, day(22)), // pullback on 1.9x volume — supply is there
  ];
  const g = gradeRetest({ bars, start: 0, end: 20, rangeLo: LO, rangeHi: HI, up: true });
  assert.equal(g.verdict, "supply-present");
  assert.equal(g.warning, true, "this is the case the card must warn about");
});

test("a break with no effort has no LPS to wait for — the WFC case", () => {
  // WFC broke up on 0.56x volume and a 0.76x bar, then closed back inside.
  const bars = [
    ...range(),
    b(111.5, 110.1, 111, 560, day(20)),  // 0.56x volume, narrow
    b(111, 108, 108.5, 680, day(21)),
  ];
  const g = gradeRetest({ bars, start: 0, end: 20, rangeLo: LO, rangeHi: HI, up: true });
  assert.equal(g.verdict, "no-effort-break");
  assert.equal(g.warning, true);
  assert.match(g.detail, /no LPS to wait for/);
});

test("SOS with price not yet returned is 'awaiting', not a failure", () => {
  const bars = [
    ...range(),
    b(116, 110, 115, 1600, day(20)),
    b(120, 116, 119, 1400, day(21)),   // ran away, never came back
    b(124, 120, 123, 1300, day(22)),
  ];
  const g = gradeRetest({ bars, start: 0, end: 20, rangeLo: LO, rangeHi: HI, up: true });
  assert.equal(g.verdict, "no-test-yet");
  assert.equal(g.warning, false, "a move that ran without you is not a warning about the setup");
  assert.match(g.detail, /alert/);
});

test("down-breaks mirror exactly — SOW then LPSY", () => {
  const bars = [
    ...range(),
    b(100, 94, 95, 1600, day(20)),      // SOW
    b(97, 94, 95, 900, day(21)),
    b(99.0, 98.0, 98.3, 700, day(22)),  // LPSY: 0.7x volume, 0.5x spread, quiet rally into broken support
  ];
  const g = gradeRetest({ bars, start: 0, end: 20, rangeLo: LO, rangeHi: HI, up: false });
  assert.equal(g.verdict, "lps");
  assert.match(g.label, /LPSY/);
});

test("a break must carry, not merely poke", () => {
  // Heavy volume and a wide bar, but the close is back inside the box.
  const bars = [...range(), b(118, 108, 109, 2000, day(20)), b(112, 108, 110, 900, day(21))];
  const g = gradeRetest({ bars, start: 0, end: 20, rangeLo: LO, rangeHi: HI, up: true });
  assert.equal(g.verdict, "no-effort-break", "volume alone is not strength if price did not hold");
});

test("degenerate inputs never throw", () => {
  assert.equal(gradeRetest({ bars: [], start: 0, end: 0, rangeLo: LO, rangeHi: HI, up: true }).verdict, "no-test-yet");
  const flat = Array.from({ length: 20 }, (_, i) => b(100, 100, 100, 0, day(i)));
  assert.equal(gradeRetest({ bars: flat, start: 0, end: 20, rangeLo: LO, rangeHi: HI, up: true }).verdict, "no-test-yet");
});

test("thresholds are exported so they can be tuned, not buried", () => {
  assert.ok(SOS_VOLUME > 1, "an SOS must beat an ordinary day");
  assert.ok(LPS_VOLUME < 1, "an LPS must be quieter than one");
});
