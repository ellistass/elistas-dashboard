// lib/setups/log.ts — keep every setup the page has ever shown.
//
// The live scan only knows what's true on the last completed bar, so a setup
// that fills, expires or loses its range simply vanished from the page. This
// log freezes each setup the FIRST time a scan sees it and never rewrites that
// snapshot; later scans only move lastSeenAt / lastState, and set goneAt once
// it drops off. The Journal's results table (build step 7) reads from here.
//
// Identity = same market, instrument, side and entry type, with ranges that
// overlap by more than half — the rule /api/setups already uses to match desk
// reads, so a range whose edge nudges by a tick stays one setup.

import { db } from "@/lib/db";
import type { InstrumentSetup, SetupScan } from "./scan";
import type { DriverScan, DriverSetup } from "./forexDriver";
import type { AbcdSetup } from "./abcd";
import type { ScanKey } from "./scanCache";

/** A setup that drops off and comes back within this many days is the same row. */
const REJOIN_DAYS = 10;

interface LogEntry {
  instrument: string; side: string; entry: string; grade: string; state: string;
  rangeLo: number; rangeHi: number; rangeStart: string; signalDate: string | null;
  entryPrice: number; stop: number; breakevenAt: number; target: number | null;
  barDate: string; snapshot: unknown;
}

const fromFutures = (s: InstrumentSetup): LogEntry => ({
  instrument: s.instrument, side: s.side, entry: s.entry, grade: s.grade, state: s.state,
  rangeLo: s.rangeLo, rangeHi: s.rangeHi, rangeStart: s.rangeStart, signalDate: s.signalDate,
  entryPrice: s.entryPrice, stop: s.stop, breakevenAt: s.breakevenAt, target: s.target,
  barDate: s.lastBarDate, snapshot: s,
});

const fromForex = (s: DriverSetup): LogEntry => ({
  instrument: s.pair, side: s.side, entry: "forex", grade: s.grade, state: s.state,
  rangeLo: s.range.lo, rangeHi: s.range.hi, rangeStart: s.range.start, signalDate: s.breakDate,
  entryPrice: s.order.entry, stop: s.order.stopLoss, breakevenAt: s.order.breakEven, target: null,
  barDate: s.lastBarDate, snapshot: s,
});

/** AB=CD (paper): logged under forex with entry "abcd" and grade "paper"; the A–C swing is its band. */
const fromAbcd = (s: AbcdSetup): LogEntry => ({
  instrument: s.pair, side: s.side, entry: "abcd", grade: "paper", state: s.state,
  rangeLo: Math.min(s.a.price, s.b.price, s.c.price), rangeHi: Math.max(s.a.price, s.b.price, s.c.price),
  rangeStart: s.a.date, signalDate: s.knownDate,
  entryPrice: s.entry, stop: s.stop, breakevenAt: s.entry + (s.entry - s.stop), target: s.target,
  barDate: s.lastBarDate, snapshot: s,
});

type Band = { rangeLo: number; rangeHi: number };
const overlaps = (a: Band, b: Band) =>
  Math.min(a.rangeHi, b.rangeHi) - Math.max(a.rangeLo, b.rangeLo) >
  0.5 * Math.min(a.rangeHi - a.rangeLo, b.rangeHi - b.rangeLo);

export async function logScan(key: ScanKey, payload: unknown): Promise<{ added: number; seen: number; gone: number }> {
  const entries: LogEntry[] =
    key === "futures"
      ? ((payload as SetupScan).setups ?? []).map(fromFutures)
      // "watch" = pressing the edge, not broken yet — not a setup, so not logged.
      : [
          ...((payload as DriverScan).setups ?? []).filter((s) => s.state !== "watch").map(fromForex),
          ...((payload as DriverScan).abcd ?? []).map(fromAbcd),
        ];

  // Instruments whose fetch failed tonight: their setups are unknown, not gone.
  const failed = new Set<string>(
    ((payload as any).errors ?? []).map((e: any) => e.instrument ?? e.pair).filter(Boolean),
  );

  const table = (db as any).setupLog;
  const now = new Date();
  const recent = await table.findMany({
    where: { market: key, lastSeenAt: { gte: new Date(now.getTime() - REJOIN_DAYS * 864e5) } },
    select: { id: true, instrument: true, side: true, entry: true, rangeLo: true, rangeHi: true, goneAt: true },
    orderBy: { lastSeenAt: "desc" },
  });

  const matched = new Set<string>();
  let added = 0;
  for (const e of entries) {
    const row = recent.find((r: any) =>
      !matched.has(r.id) && r.instrument === e.instrument && r.side === e.side && r.entry === e.entry && overlaps(r, e));
    if (row) {
      matched.add(row.id);
      await table.update({ where: { id: row.id }, data: { lastSeenAt: now, lastState: e.state, goneAt: null } });
    } else {
      await table.create({
        data: {
          market: key, instrument: e.instrument, side: e.side, entry: e.entry, grade: e.grade,
          firstState: e.state, lastState: e.state,
          rangeLo: e.rangeLo, rangeHi: e.rangeHi, rangeStart: e.rangeStart, signalDate: e.signalDate,
          entryPrice: e.entryPrice, stop: e.stop, breakevenAt: e.breakevenAt, target: e.target,
          firstBarDate: e.barDate, lastSeenAt: now, snapshot: e.snapshot as any,
        },
      });
      added++;
    }
  }

  const goneIds = recent
    .filter((r: any) => !matched.has(r.id) && r.goneAt == null && !failed.has(r.instrument))
    .map((r: any) => r.id);
  if (goneIds.length) await table.updateMany({ where: { id: { in: goneIds } }, data: { goneAt: now } });

  return { added, seen: matched.size, gone: goneIds.length };
}

/** The logged setup a card belongs to (for "Took it" / "Skip"). Same identity rule as logScan. */
export async function matchLogRow(ref: { market: string; instrument: string; side: string; entry: string; rangeLo: number; rangeHi: number }): Promise<string | null> {
  try {
    const rows = await (db as any).setupLog.findMany({
      where: { market: ref.market, instrument: ref.instrument, side: ref.side, entry: ref.entry },
      select: { id: true, rangeLo: true, rangeHi: true },
      orderBy: { lastSeenAt: "desc" },
      take: 20,
    });
    return rows.find((r: any) => overlaps(r, ref))?.id ?? null;
  } catch { return null; }
}
