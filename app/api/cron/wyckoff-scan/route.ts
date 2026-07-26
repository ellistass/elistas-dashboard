// app/api/cron/wyckoff-scan/route.ts — MANUAL Wyckoff scan + backfill trigger.
//
// NOT on the cron schedule. The scheduled daily run lives inside the combined
// trade-scan job (app/api/cron/trade-scan — fired by /api/cron/idea-outcomes
// at 21:15 UTC), where the trend screener, the Wyckoff scan and the outcome
// backfill run as one job with a single two-section Telegram digest.
//
// This route stays as a standalone trigger for testing / catch-up runs:
//   1. Full Wyckoff basket sweep — persists every detected range with its
//      blind engine verdict (outcome null).
//   2. Outcome backfill (§9) — resolves any broken-out range older than
//      RESOLVE_BARS trading days and stores what actually happened.
//
// Auth: Bearer CRON_SECRET — same pattern as the other cron routes.
// No Telegram is sent from here — digest assembly lives in trade-scan.

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { runWyckoffScan, backfillOutcomes } from "@/lib/wyckoff/scan";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let scan = null;
  let scanError: string | null = null;
  try {
    const { candidates, ...meta } = await runWyckoffScan();
    // Log counts only — the cron response is for ops, not for reading setups.
    scan = { ...meta, freshCount: candidates.length };
  } catch (e) {
    scanError = e instanceof Error ? e.message : String(e);
  }

  let backfill = null;
  let backfillError: string | null = null;
  try {
    backfill = await backfillOutcomes();
  } catch (e) {
    backfillError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    ok: !scanError && !backfillError,
    scan,
    scanError,
    backfill,
    backfillError,
  });
}
