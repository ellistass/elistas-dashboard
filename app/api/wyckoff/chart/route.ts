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
import { paceRead } from "@/lib/wyckoff/pace";
import { buildStacks, type StackableRow } from "@/lib/wyckoff/stack";

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
      // Timing marks. Safe pre-resolution: these say WHEN the scanner spoke,
      // never what it concluded.
      surfacedBarDate: true, surfacedReason: true, testBarDate: true,
    },
  });
  if (!row) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const inst = BASKET.find((b) => b.symbol === row.instrument);
  if (!inst) return NextResponse.json({ error: `${row.instrument} not in basket` }, { status: 409 });

  let chart;
  try {
    // 5y, matching the review drawer: weekly needs the depth, and the cache
    // in daily.ts means the extra history costs nothing on repeat opens.
    const bars = await fetchDailyBars(inst.yahoo, "5y");
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

  // Pace, with the DIRECTIONAL FIELD STRIPPED. `lean` is an inference about
  // which way the range resolves; printing it beside a live unresolved
  // candidate would hand over a verdict, which is the one thing the blind
  // architecture exists to prevent. The trader gets the raw asymmetry — how
  // much longer one side takes per point — and draws his own conclusion.
  const fullPace = paceRead(
    chart.bars as any,
    chart.rangeStartIdx,
    chart.breakoutIdx ?? chart.bars.length,
  );
  const { lean: _withheld, ...pace } = fullPace;

  // ── The rest of the stack ────────────────────────────────────────────────
  // Other unresolved boxes on this instrument that overlap this one in price.
  // They are not clutter: a pair pressing the same area repeatedly is the
  // signal, and the drawer is where you can actually see all of it at once.
  //
  // Same blind rule as everywhere else — engineVerdict is absent from the
  // select, so a sibling cannot leak what the front card withholds.
  let stack: Array<Record<string, unknown>> = [];
  try {
    const siblings = await (db as any).scannerCandidate.findMany({
      where: { instrument: row.instrument, outcome: null },
      select: {
        id: true, instrument: true, rangeLo: true, rangeHi: true, status: true,
        grade: true, gradeScore: true, rangeStartDate: true, breakoutDate: true,
        surfacedBarDate: true, firstSeenBarDate: true, sightingCount: true,
        traderVerdict: true, watch: true,
      },
      take: 40,
    });
    const norm: StackableRow[] = siblings.map((r: any) => ({
      ...r,
      surfacedBarDate: r.surfacedBarDate ? r.surfacedBarDate.toISOString().slice(0, 10) : null,
      firstSeenBarDate: r.firstSeenBarDate ? r.firstSeenBarDate.toISOString().slice(0, 10) : null,
    }));
    // Only the pile THIS candidate belongs to — a different area on the same
    // instrument is a different setup and does not belong in this drawer.
    const mine = buildStacks(norm).find((st) => st.rows.some((r) => r.id === row.id));
    stack = (mine?.rows ?? []).map((r: any) => ({
      id: r.id,
      rangeLo: r.rangeLo,
      rangeHi: r.rangeHi,
      status: r.status,
      grade: r.grade,
      gradeScore: r.gradeScore,
      rangeStartDate: r.rangeStartDate ? new Date(r.rangeStartDate).toISOString().slice(0, 10) : null,
      breakoutDate: r.breakoutDate ? new Date(r.breakoutDate).toISOString().slice(0, 10) : null,
      surfacedBarDate: r.surfacedBarDate,
      sightingCount: r.sightingCount,
      traderVerdict: r.traderVerdict,
      watch: r.watch,
      current: r.id === row.id,
    }));
  } catch {
    // A drawer that fails to open because the stack query failed would be a
    // poor trade for a feature that is context, not content.
    stack = [];
  }

  return NextResponse.json({
    ok: true,
    pace,
    stack,
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
    surfacedBarDate: row.surfacedBarDate ? row.surfacedBarDate.toISOString().slice(0, 10) : null,
    surfacedReason: row.surfacedReason,
    testBarDate: row.testBarDate ? row.testBarDate.toISOString().slice(0, 10) : null,
    resolved: row.outcome != null,
    ...chart,
  });
}
