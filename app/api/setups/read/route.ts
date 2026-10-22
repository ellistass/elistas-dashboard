// app/api/setups/read/route.ts — re-run the engine's accumulation/distribution
// read for one setup, live.
//
// GET ?symbol=AMD&from=2026-09-18&to=2026-10-20&side=long
//   asFired → the same window the card used (from..to inclusive)
//   now     → the same start, extended to the latest closed day
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BASKET } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { engineReadDetail } from "@/lib/wyckoff/engine";
import { completedBars } from "@/lib/setups/scan";
import { CONTRACTS } from "@/lib/data/contracts";
import { storedVolume, patchVolume } from "@/lib/data/futuresVolume";

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const inst = BASKET.find((x) => x.symbol === q.get("symbol"));
  const from = q.get("from"), to = q.get("to"), long = q.get("side") === "long";
  if (!inst || !from || !to) return NextResponse.json({ error: "symbol, from, to required" }, { status: 400 });
  try {
    let bars = completedBars(await fetchDailyBars(inst.yahoo, "5y"));
    if (CONTRACTS[inst.symbol]) {
      try { bars = patchVolume(bars, await storedVolume(inst.symbol)).bars; } catch { /* keep Yahoo volume */ }
    }
    const s = bars.findIndex((b) => b.date >= from);
    if (s < 0) return NextResponse.json({ error: "range start not in data" }, { status: 404 });
    const e = bars.findIndex((b) => b.date > to);
    const lean = (v: string) => (v === "neutral" ? null : (v === "accum") === long);
    const asFired = engineReadDetail(bars, s, e < 0 ? bars.length : e);
    const now = engineReadDetail(bars, s, bars.length);
    return NextResponse.json({
      asFired: { ...asFired, agrees: lean(asFired.verdict) },
      now: { ...now, agrees: lean(now.verdict) },
      changed: asFired.verdict !== now.verdict,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
