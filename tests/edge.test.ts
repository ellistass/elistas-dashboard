// tests/edge.test.ts — accuracy without a base rate is not a result.
//
// The Score page reported the engine at 56% as though 50% were the bar. On this
// book a model that says "up" every time scores 60%. These tests lock in the
// comparison that makes 56% legible as what it is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { baseRates, edgeFor, engineSegments, recordForCall, type EdgeRow } from "../lib/wyckoff/edge";

const mk = (n: number, verdict: string, outcome: string, terminalTest = "both"): EdgeRow[] =>
  Array.from({ length: n }, (_, i) => ({
    instrument: `X${i}`, engineVerdict: verdict, outcome, terminalTest,
  }));

test("base rates measure what price did, ignoring every model", () => {
  const rows = [...mk(60, "accum", "up"), ...mk(40, "distrib", "down"), ...mk(20, "accum", "chop")];
  const b = baseRates(rows);
  assert.equal(b.up, 60);
  assert.equal(b.down, 40);
  assert.equal(b.chop, 20);
  assert.equal(b.directional, 100);
  assert.equal(b.pUp, 0.6);
});

test("a call that only matches the drift shows no edge", () => {
  // 60% of directional outcomes are up. An ACCUM caller that is right 60% of
  // the time has done exactly nothing.
  const rows: EdgeRow[] = [
    ...mk(60, "accum", "up"),
    ...mk(40, "accum", "down"),
    ...mk(60, "distrib", "down"),   // pads the base rate toward 50/50? no —
    ...mk(90, "distrib", "up"),     // keeps overall P(up) at 0.6
  ];
  const b = baseRates(rows);
  assert.equal(Math.round(b.pUp * 100), 60);
  const r = edgeFor(rows, b, "accum");
  assert.equal(r.accuracy.pct, 60);
  assert.equal(r.basePct, 60);
  assert.equal(r.edgePts, 0);
  assert.equal(r.real, false);
  assert.match(r.verdict, /no demonstrated edge/);
});

test("a DISTRIB call is scored against the base rate for DOWN, not for UP", () => {
  // The inversion that raw accuracy hid: 48% right looks bad next to 63%, and
  // is the better call, because down only happens 40% of the time.
  const rows: EdgeRow[] = [
    ...mk(300, "accum", "up"), ...mk(200, "accum", "down"),   // pUp drifts up
    ...mk(120, "distrib", "down"), ...mk(130, "distrib", "up"),
  ];
  const b = baseRates(rows);
  const dist = edgeFor(rows, b, "distrib");
  assert.ok(dist.basePct! < 50, "the bar for a down call is the frequency of down");
  assert.ok(dist.edgePts! > 0, "48% against a 40% base is a real edge");
});

test("an edge inside its own margin of error is not claimed", () => {
  const rows: EdgeRow[] = [...mk(6, "accum", "up"), ...mk(5, "accum", "down"), ...mk(5, "distrib", "down")];
  const r = edgeFor(rows, baseRates(rows), "accum");
  assert.equal(r.real, false, "eleven calls cannot demonstrate anything");
});

test("a call worse than guessing says so outright", () => {
  const rows: EdgeRow[] = [
    ...mk(400, "accum", "up"), ...mk(100, "accum", "down"),     // base pUp high
    ...mk(10, "distrib", "down"), ...mk(200, "distrib", "up"),  // distrib badly wrong
  ];
  const r = edgeFor(rows, baseRates(rows), "distrib");
  assert.ok((r.edgePts ?? 0) < 0);
  assert.match(r.verdict, /WORSE than guessing/);
});

test("too few calls is reported as such, never as a percentage", () => {
  const rows = mk(3, "accum", "up");
  const r = edgeFor(rows, baseRates(rows), "accum");
  assert.equal(r.accuracy.pct, null);
  assert.equal(r.edgePts, null);
  assert.match(r.verdict, /too few/);
});

test("segments stay a short list — slicing thin data twenty ways manufactures findings", () => {
  const segs = engineSegments([...mk(50, "accum", "up"), ...mk(50, "distrib", "down")]);
  assert.ok(segs.length <= 6);
  assert.deepEqual(segs.map((s) => s.key), ["all", "accum", "distrib", "spring", "upthrust", "no-test"]);
});

test("recordForCall falls back to all calls when the narrow slice is too thin", () => {
  const rows: EdgeRow[] = [
    ...mk(200, "accum", "up", "both"),
    ...mk(100, "accum", "down", "both"),
    ...mk(2, "accum", "spring"),          // far too few springs to stand alone
  ];
  const r = recordForCall(rows, "accum", "spring");
  assert.ok(r, "a verdict must always arrive with some record");
  assert.ok(r!.accuracy.n > 2, "so it widens to all calls of this direction");
});

test("no record for a non-directional verdict", () => {
  assert.equal(recordForCall(mk(50, "accum", "up"), "neutral", "both"), null);
  assert.equal(recordForCall(mk(50, "accum", "up"), null, "both"), null);
});
