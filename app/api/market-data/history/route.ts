// app/api/market-data/history/route.ts
// Paginated list of BarchartSnapshot records — used by /data list view
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page  = Math.max(1, parseInt(searchParams.get("page")  ?? "1"));
    const limit = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20")));
    const skip  = (page - 1) * limit;

    const [total, snaps] = await Promise.all([
      db.barchartSnapshot.count(),
      db.barchartSnapshot.findMany({
        orderBy: { fetchedAt: "desc" },
        skip,
        take: limit,
        select: {
          id:        true,
          fetchedAt: true,
          errors:    true,
          data:      true,   // we'll summarise client-side, keep full for row counts
        },
      }),
    ]);

    // Summarise each snapshot — don't send the full JSON blob
    const rows = snaps.map((s) => {
      const d = s.data as any;
      const forexPerf   = (d?.forex?.performance?.today?.bullish?.length  ?? 0) + (d?.forex?.performance?.today?.bearish?.length  ?? 0);
      const forexSurp   = (d?.forex?.surprises?.bullish?.length  ?? 0) + (d?.forex?.surprises?.bearish?.length  ?? 0);
      const futPerf     = (d?.futures?.performance?.today?.bullish?.length ?? 0) + (d?.futures?.performance?.today?.bearish?.length ?? 0);
      const futSurp     = (d?.futures?.surprises?.bullish?.length  ?? 0) + (d?.futures?.surprises?.bearish?.length  ?? 0);
      const topForex    = (d?.forex?.performance?.today?.bullish?.[0]?.symbol ?? null) as string | null;

      return {
        id:        s.id,
        fetchedAt: s.fetchedAt,
        errors:    s.errors,
        forexPerf,
        forexSurp,
        futPerf,
        futSurp,
        topForex,
      };
    });

    return NextResponse.json({
      rows,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("Market data history error:", err);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
