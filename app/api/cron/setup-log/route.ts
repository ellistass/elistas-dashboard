// app/api/cron/setup-log/route.ts — the nightly swing job: log every completed
// day's setups, then refresh the open swing trades from Yahoo.
//
// Schedule: 00:30 UTC Tue–Sat (01:30 Lagos), after both cutoffs in scanCache:
// futures/stocks 17:15 New York, forex 17:30 New York. If the page was already
// opened after the cutoff the stored scan is current and was logged then, so
// this does nothing; otherwise it computes, stores and logs.

export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { scanSetups } from "@/lib/setups/scan";
import { scanForexDrivers } from "@/lib/setups/forexDriver";
import { cachedScan } from "@/lib/setups/scanCache";
import { refreshOpenTrades } from "@/lib/swing/trades";
import { resolveOutcomes } from "@/lib/swing/outcomes";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const out: Record<string, unknown> = {};
  // Forex is always rescanned here: a page visit just after the close may have
  // stored a scan built before Yahoo's final hour landed — the nightly one is final.
  const lanes = [
    ["futures", () => scanSetups(true), false],
    ["forex", () => scanForexDrivers(true), true],
  ] as const;
  for (const [key, run, force] of lanes) {
    try {
      const s: any = await cachedScan(key, run as () => Promise<object>, force);
      out[key] = { setups: s.setups?.length ?? 0, from: s.cachedAt ? `stored ${s.cachedAt}` : "computed now" };
    } catch (e) {
      out[key] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  // Evening maths for the trades you took (best, R now, trailing stop, hits).
  try { out.trades = await refreshOpenTrades(); }
  catch (e) { out.trades = { error: e instanceof Error ? e.message : String(e) }; }
  // Journal: play every unresolved logged setup forward under the rules.
  try { out.outcomes = await resolveOutcomes(); }
  catch (e) { out.outcomes = { error: e instanceof Error ? e.message : String(e) }; }
  return NextResponse.json(out);
}
