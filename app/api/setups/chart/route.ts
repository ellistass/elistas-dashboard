// app/api/setups/chart/route.ts — full daily history for one instrument, for
// the expanded setup chart. Fetched only when you open a chart, so the setups
// list stays light. Same feed and 10-min cache as the scan; today's forming
// bar is dropped, exactly as the rules see it.
//
// GET /api/setups/chart?instrument=NQ

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { instrumentInfo } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { completedBars } from "@/lib/setups/scan";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const symbol = new URL(req.url).searchParams.get("instrument") ?? "";
  const inst = instrumentInfo(symbol);
  if (!inst) return NextResponse.json({ error: `unknown instrument ${symbol}` }, { status: 400 });

  try {
    // 5y so the weekly and monthly views have real history behind them.
    const bars = completedBars(await fetchDailyBars(inst.yahoo, "5y"));
    return NextResponse.json({ instrument: inst.symbol, suspectVolume: inst.volumeQuality !== "real", bars });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
