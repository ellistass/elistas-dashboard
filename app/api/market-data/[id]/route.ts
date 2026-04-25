// app/api/market-data/[id]/route.ts
// Returns one full BarchartSnapshot by ID, plus matching economic + rates snapshots
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const snap = await db.barchartSnapshot.findUnique({ where: { id: params.id } });
    if (!snap) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });

    // Find nearest economic + rates snapshots (closest in time)
    const [economicSnap, ratesSnap] = await Promise.all([
      db.economicSnapshot.findFirst({
        orderBy: { fetchedAt: "desc" },
        where: { fetchedAt: { lte: new Date(snap.fetchedAt.getTime() + 3_600_000) } },
      }),
      db.ratesSnapshot.findFirst({
        orderBy: { fetchedAt: "desc" },
        where: { fetchedAt: { lte: new Date(snap.fetchedAt.getTime() + 3_600_000) } },
      }),
    ]);

    const ageMin = (d: Date | null) =>
      d ? Math.floor((Date.now() - d.getTime()) / 60_000) : null;

    return NextResponse.json({
      barchart: {
        id:         snap.id,
        fetchedAt:  snap.fetchedAt,
        ageMinutes: ageMin(snap.fetchedAt),
        errors:     snap.errors,
        data:       snap.data,
      },
      economic: {
        fetchedAt:  economicSnap?.fetchedAt ?? null,
        ageMinutes: ageMin(economicSnap?.fetchedAt ?? null),
        events:     economicSnap?.events ?? [],
      },
      rates: {
        fetchedAt:  ratesSnap?.fetchedAt ?? null,
        ageMinutes: ageMin(ratesSnap?.fetchedAt ?? null),
        rates:      ratesSnap?.rates ?? [],
      },
    });
  } catch (err: any) {
    console.error("Snapshot detail error:", err);
    return NextResponse.json({ error: "Failed to fetch snapshot" }, { status: 500 });
  }
}
