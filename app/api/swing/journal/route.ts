// app/api/swing/journal/route.ts — every setup ever seen, and whether the system works.
//
// GET  ?market=all|futures|forex → { table, rows, counts }   (rows without snapshots)
// POST → resolve outcomes now (the nightly job does this too)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveOutcomes, resultsTable } from "@/lib/swing/outcomes";

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const market = new URL(req.url).searchParams.get("market") ?? "all";
    const where = market === "all" ? {} : { market };
    const [rows, taken] = await Promise.all([
      (db as any).setupLog.findMany({
        where,
        select: {
          id: true, market: true, instrument: true, side: true, entry: true, grade: true, firstState: true, firstBarDate: true,
          entryPrice: true, stop: true, target: true, context: true, cot: true, quietRetest: true,
          outcome: true, fillDate: true, fillPrice: true, exitDate: true, exitPrice: true, exitReason: true, resultR: true, peakR: true, resolvedAt: true,
        },
        orderBy: { firstBarDate: "desc" },
      }),
      (db as any).swingTrade.findMany({
        where: market === "all" ? {} : { market },
        select: { id: true, setupLogId: true, status: true, exitDate: true, resultR: true, instrument: true, account: true },
      }),
    ]);
    const takenBy = new Map(taken.filter((t: any) => t.setupLogId).map((t: any) => [t.setupLogId, t]));
    const counts = rows.reduce((c: Record<string, number>, r: any) => { const k = r.outcome ?? "pending"; c[k] = (c[k] ?? 0) + 1; return c; }, {});
    return NextResponse.json({
      table: resultsTable(rows, taken),
      counts,
      rows: rows.map((r: any) => ({ ...r, taken: takenBy.get(r.id) ?? null })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST() {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await resolveOutcomes()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
