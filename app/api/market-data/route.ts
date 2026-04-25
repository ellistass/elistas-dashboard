// app/api/market-data/route.ts
// Returns the latest snapshot of all three data sources for the data viewer page
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const [barchartSnap, economicSnap, ratesSnap] = await Promise.all([
      db.barchartSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } }),
      db.economicSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } }),
      db.ratesSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } }),
    ]);

    // Age in minutes for each source
    const ageMin = (d: Date | null) =>
      d ? Math.floor((Date.now() - d.getTime()) / 60_000) : null;

    return NextResponse.json({
      barchart: {
        fetchedAt:    barchartSnap?.fetchedAt ?? null,
        ageMinutes:   ageMin(barchartSnap?.fetchedAt ?? null),
        errors:       barchartSnap?.errors ?? [],
        data:         barchartSnap?.data ?? null,
      },
      economic: {
        fetchedAt:    economicSnap?.fetchedAt ?? null,
        ageMinutes:   ageMin(economicSnap?.fetchedAt ?? null),
        events:       economicSnap?.events ?? [],
      },
      rates: {
        fetchedAt:    ratesSnap?.fetchedAt ?? null,
        ageMinutes:   ageMin(ratesSnap?.fetchedAt ?? null),
        rates:        ratesSnap?.rates ?? [],
      },
    });
  } catch (err: any) {
    console.error("Market data error:", err);
    return NextResponse.json({ error: "Failed to fetch market data" }, { status: 500 });
  }
}
