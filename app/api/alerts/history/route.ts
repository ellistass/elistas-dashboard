// app/api/alerts/history/route.ts
// Paginated list of DailyAlert records for the analysis history page
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

    const [total, rows] = await Promise.all([
      db.dailyAlert.count(),
      db.dailyAlert.findMany({
        orderBy: { date: "desc" },
        skip,
        take: limit,
        select: {
          id:           true,
          date:         true,
          createdAt:    true,
          sentAt:       true,
          top3:         true,
          bottom3:      true,
          priority1:    true,
          ideas:        true,
          scoringModel: true,
          dataAge:      true,
          // fullAnalysis is large — exclude from list, load on demand
        },
      }),
    ]);

    const items = rows.map(r => ({
      id:           r.id,
      date:         r.date,
      createdAt:    r.createdAt,
      sentAt:       r.sentAt,
      scoringModel: (r as any).scoringModel ?? null,
      dataAge:      (r as any).dataAge ?? null,
      priorityPair: (r.priority1 as any)?.pair ?? null,
      priorityGrade:(r.priority1 as any)?.grade ?? null,
      divergence:   (r.priority1 as any)?.divergence ?? null,
      top3:         (r.top3 as any[])?.map((c: any) => c.cur) ?? [],
      bottom3:      (r.bottom3 as any[])?.map((c: any) => c.cur) ?? [],
      ideasCount:   (r.ideas as any[])?.length ?? 0,
    }));

    return NextResponse.json({
      items,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("Alerts history error:", err);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
