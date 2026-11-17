// app/api/setups/chart4h/route.ts — intraday bars for the expanded setup chart.
// 4h = UTC 00/04/08/12/16/20 buckets (as tested). Price is kept even where Yahoo has no
// intraday volume (cash indices), so the chart can still draw the candles.
//
// GET /api/setups/chart4h?instrument=AMD          → 4h bars (3 months)
// GET /api/setups/chart4h?instrument=CL&tf=2h    → 2h bars (counted from each day's first hour)
// GET /api/setups/chart4h?instrument=CL&tf=1h    → 1h bars
// &range=6mo                                      → 6 months (Filled page: older trades)
// Forex pairs (EURUSD) and crypto (BTC, ETH) work too — they aren't in the range basket.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { instrumentInfo } from "@/lib/wyckoff/basket";
import { fetchHourBars, to4h, to2h } from "@/lib/setups/intraday";

const CRYPTO: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD" };

function yahooFor(symbol: string): string | null {
  const inst = instrumentInfo(symbol);
  if (inst) return inst.yahoo;
  if (CRYPTO[symbol]) return CRYPTO[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `${symbol}=X`;
  return null;
}

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const symbol = q.get("instrument") ?? "";
  const yahoo = yahooFor(symbol);
  if (!yahoo) return NextResponse.json({ error: "unknown instrument" }, { status: 400 });
  const range = q.get("range") === "6mo" ? "6mo" : "3mo";
  const h1 = await fetchHourBars(yahoo, false, { range, keepNoVolume: true });
  const tf = q.get("tf");
  const bars = tf === "1h" ? h1 : tf === "2h" ? to2h(h1) : to4h(h1);
  if (!bars.length) return NextResponse.json({ error: "no hourly data from Yahoo for this market" }, { status: 502 });
  return NextResponse.json({
    instrument: symbol,
    hasVolume: bars.filter((b) => b.v > 0).length > bars.length * 0.8,
    bars: bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, date: b.t })),
  });
}
