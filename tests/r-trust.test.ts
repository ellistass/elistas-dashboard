// tests/r-trust.test.ts — R must never divide by a break-even stop again.
//
// Reported total R was +8,958 while the money said -$1,736: opposite signs,
// because a broker statement records the FINAL stop and every trade whose stop
// was moved to break-even imported with a "risk" of a fraction of a pip. The
// old guard was `entryPrice !== slPrice`, exact equality only — the first test
// here is the case that walked straight through it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isRTrustworthy, stopFraction, rRejectionReason, MIN_STOP_FRACTION } from "../lib/r-trust";

test("a stop moved to near break-even is rejected", () => {
  // Ticket 52577017, real: entry 200.076, stop trailed to 200.065. Not equal
  // to entry, so the old guard passed it, and R came out -29.18 on a $13.88 loss.
  assert.equal(isRTrustworthy({ entryPrice: 200.076, initialSlPrice: 0, slPrice: 200.065 }), false);
});

test("a stop exactly at entry is rejected", () => {
  assert.equal(isRTrustworthy({ entryPrice: 100, slPrice: 100 }), false);
});

test("a real stop is kept", () => {
  // 0.175% is the median EA-captured stop on this book.
  assert.equal(isRTrustworthy({ entryPrice: 100, initialSlPrice: 99.825 }), true);
});

test("initialSlPrice wins over the current stop, but 0 falls through", () => {
  // `||` not `??`: a position opened with no stop freezes initialSlPrice at 0,
  // and treating that as authoritative would divide by the entry price.
  assert.equal(stopFraction({ entryPrice: 100, initialSlPrice: 0, slPrice: 98 }), 0.02);
  assert.equal(stopFraction({ entryPrice: 100, initialSlPrice: 98, slPrice: 99.99 }), 0.02);
});

test("no stop at all yields no fraction and no trust", () => {
  assert.equal(stopFraction({ entryPrice: 100, initialSlPrice: null, slPrice: 0 }), null);
  assert.equal(isRTrustworthy({ entryPrice: 100, initialSlPrice: null, slPrice: 0 }), false);
  assert.match(rRejectionReason({ entryPrice: 100, slPrice: 0 }) ?? "", /no stop/);
});

test("the floor is exactly inclusive", () => {
  const entry = 100;
  assert.equal(isRTrustworthy({ entryPrice: entry, initialSlPrice: entry * (1 - MIN_STOP_FRACTION) }), true);
  assert.equal(isRTrustworthy({ entryPrice: entry, initialSlPrice: entry * (1 - MIN_STOP_FRACTION / 2) }), false);
});

test("direction does not matter — distance does", () => {
  assert.equal(isRTrustworthy({ entryPrice: 100, initialSlPrice: 102 }), true);
  assert.equal(isRTrustworthy({ entryPrice: 100, initialSlPrice: 98 }), true);
});
