// app/api/wyckoff/read/route.ts — lock in the trader's blind read.
//
// POST { id, verdict: "accum" | "distrib" | "pass", entry?, stop? }
//
// THE LOCK IS SERVER-SIDE, not cosmetic. A read is accepted only when:
//   • the candidate exists,
//   • its outcome is still null (reading after resolution isn't blind), and
//   • no read has been logged yet (immutable — no edit, no re-POST).
// Anything else is a 409/400. There is deliberately NO update or delete route:
// if the read could be changed after the fact, the you-vs-engine score would
// be fiction. The response echoes only trader-facing fields — never the
// engine verdict.
//
// Auth: session (same as the other dashboard pages).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

const VERDICTS = new Set(["accum", "distrib", "pass"]);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id?: string; verdict?: string; entry?: unknown; stop?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, verdict } = body;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (!verdict || !VERDICTS.has(verdict)) {
    return NextResponse.json({ error: "verdict must be accum | distrib | pass" }, { status: 400 });
  }
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  const entry = num(body.entry);
  const stop = num(body.stop);

  const row = await (db as any).scannerCandidate.findUnique({
    where: { id },
    select: { id: true, outcome: true, traderVerdict: true },
  });
  if (!row) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  if (row.outcome != null) {
    return NextResponse.json(
      { error: "Range already resolved — a read logged now would not be blind" },
      { status: 409 },
    );
  }
  if (row.traderVerdict != null) {
    return NextResponse.json(
      { error: "Read already locked — reads are immutable once submitted" },
      { status: 409 },
    );
  }

  // Guarded write: the WHERE re-asserts "no read, no outcome" so two racing
  // submissions can't both land (the second matches zero rows).
  const res = await (db as any).scannerCandidate.updateMany({
    where: { id, traderVerdict: null, outcome: null },
    data: {
      traderVerdict: verdict,
      traderEntry: entry,
      traderStop: stop,
      traderReadAt: new Date(),
    },
  });
  if (res.count !== 1) {
    return NextResponse.json({ error: "Read already locked" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    locked: { id, verdict, entry, stop, readAt: new Date().toISOString() },
  });
}
