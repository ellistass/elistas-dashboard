// app/api/alerts/[id]/route.ts
// Returns one DailyAlert by ID — including fullAnalysis (prompt + response)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const alert = await db.dailyAlert.findUnique({ where: { id: params.id } });
    if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(alert);
  } catch (err: any) {
    console.error("Alert detail error:", err);
    return NextResponse.json({ error: "Failed to fetch alert" }, { status: 500 });
  }
}
