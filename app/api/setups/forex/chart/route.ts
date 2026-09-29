// app/api/setups/forex/chart/route.ts — bars for the expanded forex chart.
//
// GET /api/setups/forex/chart?pair=EURAUD
// NY-close candles (rebuilt from hourly — Yahoo's daily FX close is stale), with
// volume from the pair's currency futures (6E + 6A for EURAUD; one leg for USD pairs).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { forexChartBars } from "@/lib/setups/forexDriver";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pair = (new URL(req.url).searchParams.get("pair") ?? "").toUpperCase();
  try {
    const { bars, legs } = await forexChartBars(pair);
    const hasVol = bars.some((b) => b.v > 0);
    return NextResponse.json({ instrument: pair, suspectVolume: !hasVol, legs, bars });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
