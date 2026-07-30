// app/api/wyckoff/chart/route.ts — live chart data for an UNRESOLVED candidate.
//
// GET ?id=<candidateId>
//
// Serves price/volume bars + range structure so the trader can read a live
// candidate on the dashboard (TradingView stays the confirmation source).
//
// BLIND GUARANTEE: this route returns ONLY market data and disclosed trader
// facts. It never touches engineVerdict, effort numbers, or ratios — grep this
// file: those fields do not appear. Post-mortem internals live exclusively in
// /api/wyckoff/review, which serves resolved rows only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { BASKET } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { buildLiveChart, SUSPECT_VOLUME } from "@/lib/wyckoff/review";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const row = await (db as any).scannerCandidate.findUnique({
    where: { id },
    // Explicit select: engineVerdict is structurally absent from this query.
    select: {
      id: true, instrument: true, rangeLo: true, rangeHi: true, contextPct: true,
      terminalTest: true, stoppingAction: true, barsInRange: true, status: true,
      rangeStartDate: true, breakoutDate: true, outcome: true,
      traderVerdict: true, traderReadAt: true, fresh: true, loggedBlind: true,
      watch: true, watchNote: true, alertPrice: true, alertHitAt: true,
    },
  });
  if (!row) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const inst = BASKET.find((b) => b.symbol === row.instrument);
  if (!inst) return NextResponse.json({ error: `${row.instrument} not in basket` }, { status: 409 });

  let chart;
  try {
    const bars = await fetchDailyBars(inst.yahoo, "2y");
    chart = buildLiveChart(
      bars,
      row.rangeStartDate.toISOString().slice(0, 10),
      row.breakoutDate ? row.breakoutDate.toISOString().slice(0, 10) : null,
      row.rangeLo,
      row.rangeHi,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `bar fetch failed: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }
  if (!chart) {
    return NextResponse.json(
      { error: "Could not locate the stored range in the current data series" },
      { status: 409 },
    );
  }
  const brokenCutoff = new Date(Date.now() - 7 * 86_400_000);
  const readable =
    row.loggedBlind !== false &&
    ((row.status === "open" && row.fresh === true) ||
      (row.status === "broken" && row.breakoutDate != null && row.breakoutDate >= brokenCutoff));

  return NextResponse.json({
    ok: true,
    instrument: row.instrument,
    suspectVolume: SUSPECT_VOLUME.has(row.instrument),
    rangeLo: row.rangeLo,
    rangeHi: row.rangeHi,
    contextPct: row.contextPct,
    terminalTest: row.terminalTest,
    stoppingAction: row.stoppingAction,
    status: row.status,
    breakoutDate: row.breakoutDate ? row.breakoutDate.toISOString().slice(0, 10) : null,
    traderVerdict: row.traderVerdict,
    traderReadAt: row.traderReadAt ? row.traderReadAt.toISOString() : null,
    readable,
    // Triage state travels with the chart so the alert level can be drawn,
    // moved and cleared without leaving the drawer.
    id: row.id,
    watch: row.watch,
    watchNote: row.watchNote,
    alertPrice: row.alertPrice,
    alertHitAt: row.alertHitAt,
    resolved: row.outcome != null,
    ...chart,
  });
}
