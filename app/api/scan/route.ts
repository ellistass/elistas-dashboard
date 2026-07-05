// app/api/scan/route.ts — read the latest screener run for the dashboard.
//   GET /api/scan            → latest run + ranked results
//   GET /api/scan?history=N  → last N runs for a symbol trend view (summary only)

export const runtime = "nodejs";
export const maxDuration = 300; // manual POST runs the full 48-market sweep

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  // GET /api/scan?stats=1 → auto-tracked signal performance by bucket
  if (searchParams.get("stats") === "1") {
    const { outcomeStats } = await import("@/lib/screener/outcomes");
    return NextResponse.json({ stats: await outcomeStats() });
  }

  const history = Number(searchParams.get("history") ?? 0);

  if (history > 0) {
    const runs = await db.scanRun.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(history, 30),
      include: {
        results: {
          select: { symbol: true, displayName: true, adx: true, score: true, grade: true, direction: true, phase: true },
          orderBy: { score: "desc" },
        },
      },
    });
    return NextResponse.json({ runs });
  }

  const run = await db.scanRun.findFirst({
    orderBy: { createdAt: "desc" },
    include: { results: { orderBy: { score: "desc" } } },
  });
  if (!run) return NextResponse.json({ run: null, results: [] });

  const { results, ...meta } = run;
  return NextResponse.json({ run: meta, results });
}

// POST /api/scan — manual scan trigger from the dashboard (session auth, not cron).
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { runScan, persistScan } = await import("@/lib/screener/scan");
  const outcome = await runScan();
  const runId = await persistScan(outcome, "manual");
  return NextResponse.json({ ok: true, runId, scanned: outcome.results.length, errors: outcome.errors });
}
