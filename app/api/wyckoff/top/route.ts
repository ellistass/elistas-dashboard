// app/api/wyckoff/top/route.ts — the A+ setup, for the dashboard.
//
// /api/wyckoff returns the whole desk: up to 100 pending rows, 200 watched,
// 100 resolved, four counts and two scoreboards. The dashboard needs the top
// two or three cards and nothing else, on a page that polls every three
// minutes — so it gets its own narrow endpoint rather than pulling the desk's
// entire payload to throw 95% of it away.
//
// Same blind rule as the desk, enforced the same way: an explicit select that
// omits engineVerdict, plus the post-lock reveal for rows you have already
// read. Nothing here can leak a verdict the desk would have withheld.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

const SELECT = {
  id: true, instrument: true, rangeLo: true, rangeHi: true, contextPct: true,
  terminalTest: true, stoppingAction: true, barsInRange: true, status: true,
  rangeStartDate: true, breakoutDate: true,
  grade: true, gradeScore: true, gradeNotes: true,
  surfacedAt: true, surfacedBarDate: true, surfacedReason: true, testBarDate: true,
  firstSeenBarDate: true, sightings: true, sightingCount: true,
  traderVerdict: true, traderEntry: true, traderStop: true, traderReadAt: true,
  watch: true, watchNote: true, alertPrice: true, alertHitAt: true, alertHitDate: true,
  sparkBars: true, fresh: true,
} as const;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const brokenCutoff = new Date(Date.now() - 7 * 86_400_000);
    // Untriaged AND triaged-Now both count as "in front of me today". A card
    // you tagged Now is by definition the one you most wanted to see; leaving
    // it out of the dashboard's top slot would be exactly backwards. Later is
    // parked on purpose, so it stays out.
    const rows = await (db as any).scannerCandidate.findMany({
      where: {
        outcome: null,
        OR: [
          { status: "open", fresh: true },
          { status: "broken", breakoutDate: { gte: brokenCutoff } },
        ],
        NOT: { watch: "later" },
      },
      select: SELECT,
      orderBy: [{ gradeScore: "desc" }],
      take: 40,
    });

    // Post-lock reveal only — see the integrity note in app/api/wyckoff/route.ts.
    const readIds = rows.filter((r: any) => r.traderVerdict != null).map((r: any) => r.id);
    let withEngine = rows;
    if (readIds.length) {
      const verdicts = await (db as any).scannerCandidate.findMany({
        where: { id: { in: readIds } },
        select: { id: true, engineVerdict: true },
      });
      const byId = new Map(verdicts.map((v: any) => [v.id, v.engineVerdict]));
      withEngine = rows.map((r: any) =>
        byId.has(r.id) ? { ...r, engineVerdict: byId.get(r.id) } : r,
      );
    }

    const lastWrite = await (db as any).scannerCandidate.aggregate({ _max: { updatedAt: true } });

    return NextResponse.json({
      candidates: withEngine,
      total: withEngine.length,
      lastScanAt: lastWrite?._max?.updatedAt ?? null,
    });
  } catch (e) {
    // The dashboard must render even when the Wyckoff table is mid-migration —
    // an empty strip is a far better failure than a blank page.
    return NextResponse.json(
      { candidates: [], total: 0, lastScanAt: null, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
