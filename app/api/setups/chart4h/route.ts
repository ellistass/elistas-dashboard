// app/api/setups/chart4h/route.ts — ~3 months of 4h bars for the expanded setup chart.
// UTC 00/04/08/12/16/20 buckets (as tested). Price is kept even where Yahoo has no
// intraday volume (cash indices), so the chart can still draw the candles.
//
// GET /api/setups/chart4h?instrument=AMD

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { instrumentInfo } from "@/lib/wyckoff/basket";
import { fetchHourBars, to4h } from "@/lib/setups/intraday";

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inst = instrumentInfo(new URL(req.url).searchParams.get("instrument") ?? "");
  if (!inst) return NextResponse.json({ error: "unknown instrument" }, { status: 400 });
  const bars = to4h(await fetchHourBars(inst.yahoo, false, { range: "3mo", keepNoVolume: true }));
  if (!bars.length) return NextResponse.json({ error: "no hourly data from Yahoo for this market" }, { status: 502 });
  return NextResponse.json({
    instrument: inst.symbol,
    hasVolume: bars.filter((b) => b.v > 0).length > bars.length * 0.8,
    bars: bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, date: b.t })),
  });
}
