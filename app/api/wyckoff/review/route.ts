// app/api/wyckoff/review/route.ts — replay data for the resolved-case Review tool.
//
// GET ?id=<candidateId>
//
// THE BLIND WALL: this route serves RESOLVED candidates ONLY (outcome != null).
// An unresolved id gets a 403 — never bars, never engine internals. Review is
// post-mortem study, not decision support; this check is what keeps the live
// blind score honest.
//
// Bars are re-fetched on demand (manual, low-frequency action) over a 5y
// window so even the oldest seed ranges keep their 60-bar context.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { BASKET } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { buildReview, SUSPECT_VOLUME } from "@/lib/wyckoff/review";
import { paceRead, paceAgreesWith } from "@/lib/wyckoff/pace";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const row = await (db as any).scannerCandidate.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  // ── The wall ──
  if (row.outcome == null) {
    return NextResponse.json(
      { error: "Review opens resolved candidates only — this range is still live and stays blind." },
      { status: 403 },
    );
  }
  if (!row.breakoutDate) {
    return NextResponse.json({ error: "Row has no breakout bar to replay" }, { status: 409 });
  }

  const inst = BASKET.find((b) => b.symbol === row.instrument);
  if (!inst) return NextResponse.json({ error: `${row.instrument} not in basket` }, { status: 409 });

  let comp;
  try {
    const bars = await fetchDailyBars(inst.yahoo, "5y");
    comp = buildReview(
      bars,
      row.rangeStartDate.toISOString().slice(0, 10),
      row.breakoutDate.toISOString().slice(0, 10),
      row.rangeLo,
      row.rangeHi,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `bar fetch failed: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }
  if (!comp) {
    return NextResponse.json(
      { error: "Could not locate the stored range in the current data series" },
      { status: 409 },
    );
  }

  // Effort/result measured in TIME rather than volume. Included in full here —
  // lean and all — because this route serves resolved cases only, so a
  // directional inference cannot contaminate a live read.
  //
  // Worth the most on instruments where SUSPECT_VOLUME makes the engine's
  // volume-based verdict unreliable: pace needs only price and time, so it is
  // the better witness exactly where the engine is weakest.
  const pace = paceRead(comp.bars as any, comp.rangeStartIdx, comp.breakoutIdx);

  return NextResponse.json({
    ok: true,
    pace,
    paceAgrees: paceAgreesWith(pace, row.engineVerdict),
    instrument: row.instrument,
    suspectVolume: SUSPECT_VOLUME.has(row.instrument),
    rangeLo: row.rangeLo,
    rangeHi: row.rangeHi,
    contextPct: row.contextPct,
    terminalTest: row.terminalTest,
    stoppingAction: row.stoppingAction,
    outcome: row.outcome,
    engineVerdict: row.engineVerdict, // safe: resolved only
    loggedBlind: row.loggedBlind,
    traderVerdict: row.traderVerdict,
    traderReadAt: row.traderReadAt,
    breakoutDate: row.breakoutDate.toISOString().slice(0, 10),
    ...comp,
  });
}
