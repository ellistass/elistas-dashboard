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
// be fiction.
//
// The response DOES carry the engine verdict — but only on the way back out of
// a successful lock, once the write has landed and the read is immutable. The
// blind is a rule about the order of two events, not a secret: your call goes
// on the record first, and only then do you get to see the engine's, while
// there is still a trade to size. Reading it before you commit is what the
// GET-side select prevents; reading it after is the whole reason the number
// exists.
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
    select: { id: true, outcome: true, traderVerdict: true, status: true, fresh: true, breakoutDate: true, loggedBlind: true },
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
  // Only CURRENTLY-READABLE candidates accept a read — the same freshness rule
  // the page uses, enforced here so a direct POST can't log a "blind" read on
  // a stale range whose resolution is already visible on the chart.
  const brokenCutoff = new Date(Date.now() - 7 * 86_400_000);
  const readable =
    row.loggedBlind !== false &&
    ((row.status === "open" && row.fresh === true) ||
      (row.status === "broken" && row.breakoutDate != null && new Date(row.breakoutDate) >= brokenCutoff));
  if (!readable) {
    return NextResponse.json(
      { error: "Candidate is not at a live decision point — reading it would not be blind" },
      { status: 409 },
    );
  }

  // Guarded write: the WHERE re-asserts "no read, no outcome" so two racing
  // submissions can't both land (the second matches zero rows).
  const res: { count: number } = await (db as any).scannerCandidate.updateMany({
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

  // Now — and only now — the engine's call.
  const revealed = await (db as any).scannerCandidate.findUnique({
    where: { id },
    select: { engineVerdict: true },
  });

  return NextResponse.json({
    ok: true,
    locked: { id, verdict, entry, stop, readAt: new Date().toISOString() },
    engineVerdict: revealed?.engineVerdict ?? null,
  });
}
