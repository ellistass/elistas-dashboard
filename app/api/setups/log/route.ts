// app/api/setups/log/route.ts — the setup history (lib/setups/log.ts).
//
// GET ?market=futures|forex|all&days=90 → rows newest first, WITHOUT the
// snapshot (it carries chart bars; the Journal will fetch it per row).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const market = q.get("market") ?? "all";
  const days = Math.min(Math.max(Number(q.get("days")) || 90, 1), 730);
  try {
    const rows = await (db as any).setupLog.findMany({
      where: {
        firstSeenAt: { gte: new Date(Date.now() - days * 864e5) },
        ...(market === "all" ? {} : { market }),
      },
      select: {
        id: true, market: true, instrument: true, side: true, entry: true, grade: true,
        firstState: true, lastState: true, rangeLo: true, rangeHi: true, signalDate: true,
        entryPrice: true, stop: true, breakevenAt: true, target: true,
        firstBarDate: true, firstSeenAt: true, lastSeenAt: true, goneAt: true,
      },
      orderBy: { firstSeenAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
