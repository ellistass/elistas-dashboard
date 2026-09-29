// lib/swing/feeds.ts — which Yahoo series prices a trade in the terms you
// actually executed, and fetching its completed daily bars.
//
// Your fills are CFD / spot prices, so the evening maths must use a series in
// the same terms:
//   forex (and the 6E/6J/… currency futures) → our NY-close spot candles
//   US index futures → the cash index (US500 tracks ^GSPC, not ES=F)
//   stocks → the stock itself
//   everything else → the basket's Yahoo symbol (commodity CFDs track futures)
// A feed is stored on the trade ("spot:EURUSD" / "yahoo:^GSPC") and can be
// edited, and the broker-best override covers the remaining differences.

import { instrumentInfo } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { fetchSpot } from "@/lib/setups/forexDriver";
import { completedBars } from "@/lib/setups/scan";
import { fxPairFor, type DayBar } from "./core";

const CASH_INDEX: Record<string, string> = { ES: "^GSPC", NQ: "^NDX", YM: "^DJI", RTY: "^RUT" };

export function defaultFeed(instrument: string): string {
  const pair = fxPairFor(instrument);
  if (pair) return `spot:${pair}`;
  if (CASH_INDEX[instrument]) return `yahoo:${CASH_INDEX[instrument]}`;
  return `yahoo:${instrumentInfo(instrument)?.yahoo ?? instrument}`;
}

export async function fetchFeedBars(feed: string): Promise<DayBar[]> {
  const [kind, sym] = feed.split(":", 2);
  if (!sym) throw new Error(`bad feed "${feed}"`);
  if (kind === "spot") return fetchSpot(sym);
  if (kind === "yahoo") return completedBars(await fetchDailyBars(sym, "1y"));
  throw new Error(`unknown feed kind "${kind}"`);
}
