// app/api/scanner/run/route.ts — internal Wyckoff Range Scanner endpoints.
//
//   POST → run the full basket sweep: detect ranges, persist EVERY range with
//          its locked engine verdict (outcome null), return ONLY fresh
//          candidates — verdict-free (§10 hard rule). Safe to run repeatedly:
//          frozen (broken-out) rows are never touched again, open ranges
//          update in place.
//
// Auth: Bearer ROUTINE_SECRET (or CRON_SECRET fallback) — the same internal
// token the MCP server uses for get_scoring_data / save_scoring_result.
//
// The response NEVER includes engineVerdict, outcome, or any direction field.

export const runtime = "nodejs";
export const maxDuration = 300; // full 63-instrument sweep + persistence
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { runWyckoffScan } from "@/lib/wyckoff/scan";

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = process.env.ROUTINE_SECRET ?? process.env.CRON_SECRET ?? "";
  return !!token && auth === `Bearer ${token}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { candidates, scanned, rangesFound, persisted, errors } = await runWyckoffScan();
    return NextResponse.json({ ok: true, candidates, scanned, rangesFound, persisted, errors });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
