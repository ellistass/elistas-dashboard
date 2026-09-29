// app/api/setups/forex/route.ts — the forex reversal-break retest scan (28 spot pairs).
//
// GET            → cached scan (15 min)
// GET ?fresh=1   → force a rescan
//
// Separate from /api/setups (futures/stocks, volume rules) because it runs on
// different data: spot pairs on our own New York-close candles, no volume.
// Nothing here reads or writes the Wyckoff desk.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { scanForexDrivers } from "@/lib/setups/forexDriver";
import { cachedScan } from "@/lib/setups/scanCache";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    // Stored once per completed NY-close day; "rescan" (?fresh=1) forces a live run.
    return NextResponse.json(await cachedScan("forex", () => scanForexDrivers(true), fresh));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
