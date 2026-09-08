// tests/tradingview.test.ts — the volume route must land on a feed with volume.
//
// volumeQuality "suspect" is a routing instruction, not a quality judgement:
// our feed's volume is unusable there, so read it on the exchange feed. That
// only works if the symbol we hand over actually carries volume — and the
// naive version of this fails silently, because a cash index resolves fine on
// TradingView and shows an empty volume pane.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tradingViewFull, tradingViewUrl, volumeRouteNote, SUSPECT_VOLUME, BASKET,
} from "../lib/wyckoff/basket";

test("futures carry their exchange prefix — that is what pins the real feed", () => {
  assert.equal(tradingViewFull("6E"), "CME:6E1!");
  assert.equal(tradingViewFull("GC"), "COMEX:GC1!");
  assert.equal(tradingViewFull("CL"), "NYMEX:CL1!");
  assert.equal(tradingViewFull("ZC"), "CBOT:ZC1!");
  assert.equal(tradingViewFull("SB"), "ICEUS:SB1!");
  assert.equal(tradingViewFull("ES"), "CME_MINI:ES1!");
});

test("cash-index reads route to the FUTURE, never the index", () => {
  // The failure this guards: TVC:FTSE resolves perfectly and has no volume,
  // so the route would look like it worked and deliver nothing.
  assert.equal(tradingViewFull("DAX"), "EUREX:FDAX1!");
  assert.equal(tradingViewFull("FTSE"), "ICEEUR:Z1!");
  assert.equal(tradingViewFull("STOXX"), "EUREX:FESX1!");
  assert.equal(tradingViewFull("CAC"), "EURONEXT:FCE1!");
  assert.equal(tradingViewFull("NKY"), "CME:NKD1!");
  assert.equal(tradingViewFull("HSI"), "HKEX:HSI1!");
  assert.equal(tradingViewFull("ASX"), "ASX:AP1!");
});

test("no suspect-volume instrument is left pointing at a bare symbol", () => {
  // A bare symbol lets TradingView pick the source, and picking a volume-less
  // one is precisely the failure the flag exists to route around.
  const unrouted = BASKET
    .filter((i) => SUSPECT_VOLUME.has(i.symbol))
    .filter((i) => !tradingViewFull(i.symbol).includes(":"));
  assert.deepEqual(unrouted.map((i) => i.symbol), [], "every suspect instrument needs an exchange");
});

test("stocks stay unprefixed — the consolidated tape is already right", () => {
  assert.equal(tradingViewFull("AAPL"), "AAPL");
  assert.equal(tradingViewFull("SPY"), "SPY");
  assert.equal(volumeRouteNote("AAPL"), null, "no route needed where the feed is fine");
});

test("every suspect instrument explains where to go and why", () => {
  for (const i of BASKET.filter((x) => SUSPECT_VOLUME.has(x.symbol))) {
    const note = volumeRouteNote(i.symbol);
    assert.ok(note, `${i.symbol} needs a route note`);
    assert.ok(note!.includes(tradingViewFull(i.symbol)), `${i.symbol} note must name the symbol to open`);
  }
});

test("the url is a real, encoded TradingView chart link", () => {
  const u = tradingViewUrl("DAX");
  assert.ok(u.startsWith("https://www.tradingview.com/chart/?symbol="));
  assert.ok(u.includes("EUREX%3AFDAX1!"), "the colon must be encoded");
});

test("an unknown symbol degrades instead of throwing", () => {
  assert.equal(tradingViewFull("NOT_A_THING"), "NOT_A_THING");
  assert.equal(volumeRouteNote("NOT_A_THING"), null);
});
