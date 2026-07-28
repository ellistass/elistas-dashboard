// app/api/wyckoff/watch/route.ts — triage a candidate (mutable, reversible).
//
// POST { id, watch?: "now" | "later" | null, note?: string | null, alertPrice?: number | null }
//
// WHY THIS IS NOT /read: a triage tag is NOT a verdict. It says "keep this in
// front of me", never accum or distrib, and it carries no direction — so it can
// be changed, cleared and re-set as often as you like without touching the
// you-vs-engine benchmark, which reads traderVerdict and nothing else. Where
// /read is a one-way immutable lock, this route is deliberately a normal edit.
//
// Only the keys PRESENT in the body are written, so the page can save the note
// without disturbing the tag, and vice versa.
//
// BLIND GUARANTEE: the select lists and the response echo trader-facing fields
// only — engineVerdict is structurally absent from this file.
//
// Auth: session (same as the other dashboard pages).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

const TAGS = new Set(["now", "later"]);
const NOTE_MAX = 500;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = body.id;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const row = await (db as any).scannerCandidate.findUnique({
    where: { id },
    select: {
      id: true, outcome: true, rangeLo: true, rangeHi: true,
      watch: true, watchNote: true, alertPrice: true,
    },
  });
  if (!row) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const data: Record<string, unknown> = {};

  // ── tag ──────────────────────────────────────────────────────────────────
  if ("watch" in body) {
    const w = body.watch;
    if (w !== null && (typeof w !== "string" || !TAGS.has(w))) {
      return NextResponse.json({ error: 'watch must be "now" | "later" | null' }, { status: 400 });
    }
    if (w !== null && row.outcome != null) {
      return NextResponse.json(
        { error: "Range already resolved — nothing left to watch. Open it under Resolved instead." },
        { status: 409 },
      );
    }
    data.watch = w;
    data.watchAt = w ? new Date() : null;
    // Untagging drops the alert with it: an alert on an untracked range is
    // exactly the kind of orphan ping that makes a watchlist feel like noise.
    if (w === null) {
      data.alertPrice = null;
      data.alertSetAt = null;
      data.alertHitAt = null;
      data.alertHitDate = null;
    }
  }

  // ── note (allowed even after resolution — that is the point of context) ──
  if ("note" in body) {
    const n = body.note;
    if (n !== null && typeof n !== "string") {
      return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
    }
    const trimmed = typeof n === "string" ? n.trim().slice(0, NOTE_MAX) : null;
    data.watchNote = trimmed ? trimmed : null;
  }

  // ── alert level ──────────────────────────────────────────────────────────
  if ("alertPrice" in body) {
    const p = body.alertPrice;
    if (p === null) {
      data.alertPrice = null;
      data.alertSetAt = null;
      data.alertHitAt = null;
      data.alertHitDate = null;
    } else {
      if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) {
        return NextResponse.json({ error: "alertPrice must be a positive number or null" }, { status: 400 });
      }
      if (row.outcome != null) {
        return NextResponse.json(
          { error: "Range already resolved — an alert on it can never fire" },
          { status: 409 },
        );
      }
      // Sanity band: a fat-fingered level 100x off the box would sit armed
      // forever and quietly look like a working alert.
      const span = Math.max(row.rangeHi - row.rangeLo, row.rangeHi * 0.01);
      if (p < row.rangeLo - span * 20 || p > row.rangeHi + span * 20) {
        return NextResponse.json(
          { error: `alertPrice ${p} is far outside the ${row.rangeLo}–${row.rangeHi} box — check the level` },
          { status: 400 },
        );
      }
      data.alertPrice = p;
      data.alertSetAt = new Date();
      // Re-arming clears any previous hit so the level can fire again.
      data.alertHitAt = null;
      data.alertHitDate = null;
      // An alert implies watching — setting one on an untriaged card files it
      // under "later" rather than leaving it to be swept.
      if (!row.watch && !("watch" in body)) {
        data.watch = "later";
        data.watchAt = new Date();
      }
    }
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const updated = await (db as any).scannerCandidate.update({
    where: { id },
    data,
    select: {
      id: true, watch: true, watchNote: true, watchAt: true,
      alertPrice: true, alertSetAt: true, alertHitAt: true, alertHitDate: true,
    },
  });

  return NextResponse.json({ ok: true, ...updated });
}
