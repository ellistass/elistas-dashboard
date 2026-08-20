// app/api/wyckoff/route.ts — data + manual scan for the /wyckoff page.
//
// GET  → { pending, watching, resolved, score }
// POST → run the full Wyckoff basket sweep on demand ("Run scan" button).
//        Persists every range (blind verdict server-side), no Telegram —
//        identical to the nightly lane, just user-initiated.
//
// INTEGRITY RULE (the blind lives here, not in the UI): pending rows
// (outcome == null) are selected with an EXPLICIT field list that omits
// engineVerdict — the verdict physically never leaves the server before the
// range resolves, so it cannot be recovered from the network response.
// Resolved rows reveal everything: your read, the engine's, and the outcome.
//
// Auth: session (same as the other dashboard pages).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // POST runs the full 63-instrument sweep

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeScoreboard, type BenchmarkRow } from "@/lib/wyckoff/benchmark";

// Fields safe to show BEFORE resolution. engineVerdict is deliberately absent.
const PENDING_SELECT = {
  id: true,
  instrument: true,
  rangeLo: true,
  rangeHi: true,
  contextPct: true,
  terminalTest: true,
  stoppingAction: true,
  barsInRange: true,
  status: true,
  rangeStartDate: true,
  breakoutDate: true,
  scanDate: true,
  updatedAt: true,
  traderVerdict: true,
  traderEntry: true,
  traderStop: true,
  traderReadAt: true,
  // Triage is trader-side data — safe before resolution, and the whole point
  // is that it survives the range falling out of the fresh list.
  fresh: true,
  // Structural grade + timing. Safe before resolution: the grade is built only
  // from facts already in this select (terminal test, context, bars) plus the
  // boundary-touch counts, and never from engineVerdict. See lib/wyckoff/grade.ts.
  grade: true,
  gradeScore: true,
  gradeNotes: true,
  touchesHi: true,
  touchesLo: true,
  surfacedAt: true,
  surfacedBarDate: true,
  surfacedReason: true,
  testBarDate: true,
  sparkBars: true,
  watch: true,
  watchNote: true,
  watchAt: true,
  alertPrice: true,
  alertSetAt: true,
  alertHitAt: true,
  alertHitDate: true,
} as const;

// The single freshness rule, shared by the desk and /api/wyckoff/read: a row is
// READABLE while the decision is still live. Watched rows outlive that window,
// so each one carries this flag and the card hides its form once it flips.
const brokenWindow = () => new Date(Date.now() - 7 * 86_400_000);
function isReadable(r: { status: string; fresh: boolean; breakoutDate: Date | null }): boolean {
  return (
    (r.status === "open" && r.fresh === true) ||
    (r.status === "broken" && r.breakoutDate != null && new Date(r.breakoutDate) >= brokenWindow())
  );
}

/**
 * Attach the trade you actually took to the read it came from.
 *
 * Trade.candidateId is a plain column rather than a declared Prisma relation,
 * so there is no `include` to lean on — one query for every id on the page,
 * then a map. Cheap, and it keeps ScannerCandidate free of a back-relation it
 * does not otherwise need.
 *
 * Safe before resolution: this returns YOUR OWN trade, not anything the engine
 * knows. Nothing here touches engineVerdict.
 */
async function attachTrades<T extends { id: string }>(rows: T[]): Promise<T[]> {
  if (!rows.length) return rows
  try {
    const trades = await (db as any).trade.findMany({
      where: { candidateId: { in: rows.map((r) => r.id) } },
      select: {
        id: true, candidateId: true, ticket: true, pair: true, direction: true,
        entryPrice: true, slPrice: true, outcome: true, resultR: true,
        profitCcy: true, openTimeUtc: true, closeTimeUtc: true,
        readAdherence: true, entryDriftR: true, stopWidenedR: true,
        ruleViolations: true, behaviorFlags: true,
      },
      orderBy: { openTimeUtc: 'asc' },
    })
    if (!trades.length) return rows
    const byCandidate = new Map<string, any[]>()
    for (const t of trades) {
      const list = byCandidate.get(t.candidateId) ?? []
      list.push(t)
      byCandidate.set(t.candidateId, list)
    }
    return rows.map((r) => ({ ...r, trades: byCandidate.get(r.id) ?? [] }))
  } catch {
    // Columns not pushed yet — the page must still render.
    return rows
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Setup guards — surface the ACTUAL problem instead of a bare 500.
  if (!(db as any).scannerCandidate) {
    return NextResponse.json(
      { error: "Prisma client has no ScannerCandidate model — run `npm run db:push` (regenerates the client) and restart/redeploy." },
      { status: 500 },
    );
  }

  try {
    // READABLE = blind decisions only, mirroring the scan_ranges fresh filter:
    //   • open ranges AT A DECISION POINT (fresh flag, refreshed each scan)
    //   • breakouts within the last ~week (break-and-retest window — the chart
    //     hasn't shown the resolution yet)
    // Everything else with outcome=null is still TRACKED in the DB (open ranges
    // drifting mid-box, old rows awaiting backfill) but reading those wouldn't
    // be a live blind decision, so they don't get a form.
    const brokenCutoff = brokenWindow();
    // Triaged rows leave the desk and live in the Watching section instead —
    // the desk stays an inbox you can empty, which is the whole point of
    // tagging: fewer cards in front of you, not more.
    const pending = await (db as any).scannerCandidate.findMany({
      where: {
        outcome: null,
        watch: null,
        OR: [
          { status: "open", fresh: true },
          { status: "broken", breakoutDate: { gte: brokenCutoff } },
        ],
      },
      select: PENDING_SELECT,
      orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
      take: 100,
    });

    // Watching: everything you triaged that hasn't resolved yet, fresh or not.
    // Same blind select — a watched row that is still unresolved must not leak
    // the engine verdict just because you starred it.
    const watchingRaw = await (db as any).scannerCandidate.findMany({
      where: { outcome: null, watch: { not: null } },
      select: PENDING_SELECT,
      orderBy: [{ watchAt: "desc" }],
      take: 200,
    });
    const watching = watchingRaw.map((r: any) => ({ ...r, readable: isReadable(r) }));

    // Context counts for the note line under the section title.
    const trackedOpen = await (db as any).scannerCandidate.count({
      where: { outcome: null, status: "open", fresh: false, watch: null },
    });
    const awaitingBackfill = await (db as any).scannerCandidate.count({
      where: { outcome: null, status: "broken", breakoutDate: { lt: brokenCutoff } },
    });

    // Resolved: full reveal — read, verdict, outcome side by side.
    const resolved = await (db as any).scannerCandidate.findMany({
      where: { outcome: { not: null } },
      orderBy: [{ outcomeAt: "desc" }],
      take: 100,
    });

    // Scoreboard over ALL resolved rows (not just the 100 shown).
    const allResolved: BenchmarkRow[] = await (db as any).scannerCandidate.findMany({
      where: { outcome: { not: null } },
      select: { instrument: true, outcome: true, engineVerdict: true, traderVerdict: true, loggedBlind: true },
    });

    // Discipline metric: pass rate over ALL locked reads (resolved or not) —
    // an early-warning gauge that moves weeks before the accuracy tiles do.
    // Only blind-logged rows count, same rule as the score.
    const readsTotal = await (db as any).scannerCandidate.count({
      where: { traderVerdict: { not: null }, loggedBlind: true },
    });
    const readsPass = await (db as any).scannerCandidate.count({
      where: { traderVerdict: "pass", loggedBlind: true },
    });

    // Freshness readout for the header strip. max(updatedAt) is when the
    // scanner last wrote anything — if that is days old, the desk is showing a
    // stale market and the trader needs to know before reading a chart.
    const lastWrite = await (db as any).scannerCandidate.aggregate({ _max: { updatedAt: true } });

    return NextResponse.json({
      lastScanAt: lastWrite?._max?.updatedAt ?? null,
      pending: await attachTrades(pending),
      watching: await attachTrades(watching),
      resolved: await attachTrades(resolved),
      trackedOpen,
      awaitingBackfill,
      passRate: { total: readsTotal, pass: readsPass },
      score: computeScoreboard(allResolved),
    });
  } catch (e: any) {
    // P2021 = table does not exist — the one everyone hits before db:push.
    const msg = String(e?.message ?? "");
    const missingTable = e?.code === "P2021" || /scanner_candidates/.test(msg);
    // Same fix, different symptom: the table exists but the triage columns
    // don't yet, so Prisma rejects the arg instead of the model.
    const missingColumn = /Unknown arg|Unknown field|column .* does not exist/i.test(msg) && /watch|alert/i.test(msg);
    return NextResponse.json(
      {
        error: missingTable || missingColumn
          ? "The watchlist columns aren't in the database yet — run `npm run db:push` from elistas-dashboard (it regenerates the Prisma client too), then reload."
          : e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

// POST — manual scan trigger from the dashboard (session auth, like /api/scan).
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { runWyckoffScan, backfillOutcomes } = await import("@/lib/wyckoff/scan");
    const { candidates, alerts, scanned, rangesFound, persisted, staleRemoved, latestBarDate, errors } =
      await runWyckoffScan();
    // Backfill too, so resolvable history moves to the revealed section instead
    // of lingering as unreadable "unresolved" rows.
    const backfill = await backfillOutcomes().catch((e) => ({
      checked: 0, updated: 0, notReady: 0,
      errors: [{ instrument: "*", message: e instanceof Error ? e.message : String(e) }],
    }));
    return NextResponse.json({
      ok: true,
      scanned,
      rangesFound,
      persisted,
      staleRemoved,
      freshCount: candidates.length,
      alertsFired: alerts.length,
      latestBarDate,
      backfill,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
