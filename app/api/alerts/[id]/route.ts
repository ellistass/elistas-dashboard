// app/api/alerts/[id]/route.ts
// Returns one DailyAlert by ID — including fullAnalysis (prompt + response)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeRanking } from "@/lib/normalize-ranking";
import { pickDxyVix } from "@/lib/dashboard-context";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const alert = await db.dailyAlert.findUnique({ where: { id: params.id } });
    if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const fa: any = (alert as any).fullAnalysis ?? {};
    const sourceScores = fa.scores ?? fa.allScores ?? [];

    // Sectors / macros — prefer the snapshot captured at score time
    // (fa.sectors, fa.macros). Fall back to the current barchartSnapshot for
    // legacy rows that pre-date the snapshot-on-save change. Falling back to
    // "current" is drift-prone for old rows, but it's better than empty and
    // we mark the source so the UI can say "current — not saved".
    let sectors: any[] = Array.isArray(fa.sectors) ? fa.sectors : [];
    let macros: any[] = Array.isArray(fa.macros) ? fa.macros : [];
    let macroSource: "saved" | "current-fallback" | "none" = "none";
    let barchartFetchedAt: Date | string | null = fa.barchartFetchedAt ?? null;

    if (sectors.length > 0 || macros.length > 0) {
      macroSource = "saved";
    } else {
      const snap = await db.barchartSnapshot.findFirst({
        orderBy: { fetchedAt: "desc" },
        select: { data: true, fetchedAt: true },
      });
      const data: any = snap?.data ?? {};
      sectors = (data?.sectors as any[]) ?? [];
      macros = pickDxyVix(data);
      barchartFetchedAt = snap?.fetchedAt ?? null;
      if (sectors.length > 0 || macros.length > 0) macroSource = "current-fallback";
    }

    return NextResponse.json({
      ...alert,
      top3: normalizeRanking(alert.top3, sourceScores),
      bottom3: normalizeRanking(alert.bottom3, sourceScores),
      sectors,
      macros,
      macroSource,
      barchartFetchedAt,
    });
  } catch (err: any) {
    console.error("Alert detail error:", err);
    return NextResponse.json({ error: "Failed to fetch alert" }, { status: 500 });
  }
}
