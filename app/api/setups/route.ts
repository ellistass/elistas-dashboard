// app/api/setups/route.ts — live mechanical setups across the basket.
//
// GET            → cached scan (15 min)
// GET ?fresh=1   → force a rescan
//
// Your locked read, where one exists for the same range, rides along as
// `yourRead`. The setup's own engine read (`setupRead`) is always included;
// `deskUnread` marks ranges still waiting for your blind read on the desk, and
// the page keeps the engine read behind a click for those, so training isn't
// spoiled by accident.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { scanSetups } from "@/lib/setups/scan";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const scan = await scanSetups(fresh);

    // Desk rows for the same instruments: your locked reads, and ranges still
    // waiting for a read (for those the setup's engine read starts hidden).
    const instruments = [...new Set(scan.setups.map((s) => s.instrument))];
    const desk = instruments.length
      ? await (db as any).scannerCandidate.findMany({
          where: { instrument: { in: instruments }, OR: [{ traderVerdict: { not: null } }, { outcome: null }] },
          select: { instrument: true, rangeLo: true, rangeHi: true, traderVerdict: true, traderReadAt: true },
          orderBy: { traderReadAt: "desc" },
        })
      : [];
    const overlaps = (x: any, s: { instrument: string; rangeLo: number; rangeHi: number }) =>
      x.instrument === s.instrument &&
      Math.min(x.rangeHi, s.rangeHi) - Math.max(x.rangeLo, s.rangeLo) > 0.5 * (s.rangeHi - s.rangeLo);

    const setups = scan.setups.map((s) => {
      const read = desk.find((x: any) => x.traderVerdict != null && overlaps(x, s));
      const verdict: string | null = read?.traderVerdict ?? null;
      const agrees =
        verdict == null || verdict === "pass" ? null
        : (verdict === "accum") === (s.side === "long");
      const deskUnread = !read && desk.some((x: any) => x.traderVerdict == null && overlaps(x, s));
      return { ...s, yourRead: verdict, readAgrees: agrees, deskUnread };
    });

    return NextResponse.json({ ...scan, setups });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
