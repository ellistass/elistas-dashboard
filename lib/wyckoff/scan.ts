// lib/wyckoff/scan.ts — Wyckoff Range Scanner orchestrator (§10–§12).
//
// Two consumers, two filters:
//   • The DATABASE gets EVERY detected range (scanner_candidates row with the
//     locked engine verdict, outcome null) — the benchmark needs the full
//     sample.
//   • The TRADER'S PAYLOAD gets only FRESH candidates (open-at-decision-point
//     or just-broke-out) and NEVER contains the engine verdict, a direction,
//     or an entry recommendation. The trader reads the chart and decides.
//
// Dedup: one row per (instrument, rangeStartDate). Range starts are stable
// across daily re-scans (earlier bars never change), so an open range updates
// in place until it breaks out, then freezes. Rows are never touched again
// once status is "broken" — that is the moment the verdict locks.

import { db } from "@/lib/db";
import { BASKET } from "./basket";
import { fetchDailyBars } from "./daily";
import {
  detectRanges,
  contextPct,
  lastSpring,
  lastUpthrust,
  terminalTest,
  stoppingAction,
  engineVerdict,
  outcome,
  outcomeReady,
  isFresh,
  type Bar,
  type DetectedRange,
  type TerminalTest,
} from "./engine";

// §10 — the shape returned to the trader. No verdict. No direction. No entry.
export interface Candidate {
  instrument: string;
  rangeLo: number;
  rangeHi: number;
  contextPct: number | null; // null = not enough history before the range (§4)
  terminalTest: TerminalTest;
  stoppingAction: boolean;
  barsInRange: number;
  status: "open" | "broken"; // open = no breakout yet (pre-breakout read)
  rangeStartDate: string; // YYYY-MM-DD
  breakoutDate: string | null; // date of bar `end`; null while the range is open
  lastBarDate: string; // most recent bar in the series (data freshness)
}

export interface WyckoffScanResult {
  candidates: Candidate[]; // FRESH only, neutral sort, verdict-free
  scanned: number; // instruments successfully fetched
  rangesFound: number; // all ranges across all instruments (persisted)
  persisted: number; // rows written/updated this run
  staleRemoved: number; // phantom open rows swept (range re-anchored to a new start)
  latestBarDate: string | null; // newest bar seen across all instruments —
  //                               lets the digest show what data date the scan
  //                               actually read (staleness visibility)
  errors: Array<{ instrument: string; message: string }>;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const round2 = (v: number) => Math.round(v * 100) / 100;
const toUtcDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00Z`);

interface AnalyzedRange {
  range: DetectedRange;
  candidate: Candidate;
  verdict: string; // LOGGED, never surfaced
  loggedBlind: boolean; // true when the outcome was NOT yet determinable at log time
  fresh: boolean; // at a decision point NOW (§10 filter) — drives payload AND page
}

function analyze(instrument: string, bars: Bar[], range: DetectedRange): AnalyzedRange {
  const { start, end, lo, hi, status } = range;
  const springIdx = lastSpring(bars, start, end, lo);
  const upthrustIdx = lastUpthrust(bars, start, end, hi);
  const cp = contextPct(bars, start);
  const candidate: Candidate = {
    instrument,
    rangeLo: round6(lo),
    rangeHi: round6(hi),
    contextPct: cp == null ? null : round2(cp),
    terminalTest: terminalTest(springIdx, upthrustIdx),
    stoppingAction: stoppingAction(bars, start, end),
    barsInRange: end - start,
    status,
    rangeStartDate: bars[start].date,
    breakoutDate: status === "broken" ? bars[end].date : null,
    lastBarDate: bars[bars.length - 1].date,
  };
  return {
    range,
    candidate,
    verdict: engineVerdict(bars, start, end),
    // Historical ranges (first backfill of the 2y window) already have their
    // outcome visible in the data at log time — flag them so the strict
    // you-vs-engine benchmark can filter to genuinely blind verdicts.
    loggedBlind: status === "open" || !outcomeReady(bars.length, end),
    fresh: isFresh(bars, range, springIdx, upthrustIdx),
  };
}

/** Persist one analyzed range. Returns true if a row was written/updated. */
async function persistRange(a: AnalyzedRange): Promise<boolean> {
  const key = {
    instrument: a.candidate.instrument,
    rangeStartDate: toUtcDate(a.candidate.rangeStartDate),
  };
  const existing = await (db as any).scannerCandidate.findUnique({
    where: { instrument_rangeStartDate: key },
    select: { id: true, status: true, outcome: true },
  });

  // Frozen: once broken out (verdict locked) or outcome recorded, never touch.
  if (existing && (existing.status === "broken" || existing.outcome != null)) return false;

  const data = {
    rangeLo: a.candidate.rangeLo,
    rangeHi: a.candidate.rangeHi,
    contextPct: a.candidate.contextPct,
    terminalTest: a.candidate.terminalTest,
    stoppingAction: a.candidate.stoppingAction,
    barsInRange: a.candidate.barsInRange,
    status: a.candidate.status,
    engineVerdict: a.verdict,
    loggedBlind: a.loggedBlind,
    fresh: a.fresh, // refreshed on every scan while the row is still open
    breakoutDate: a.candidate.breakoutDate ? toUtcDate(a.candidate.breakoutDate) : null,
  };
  if (existing) {
    await (db as any).scannerCandidate.update({ where: { id: existing.id }, data });
  } else {
    await (db as any).scannerCandidate.create({ data: { ...key, ...data, outcome: null } });
  }
  return true;
}

/** Full basket sweep: detect → persist ALL → return FRESH (verdict-free). */
export async function runWyckoffScan(): Promise<WyckoffScanResult> {
  const fresh: Candidate[] = [];
  const errors: Array<{ instrument: string; message: string }> = [];
  let scanned = 0;
  let rangesFound = 0;
  let persisted = 0;
  let staleRemoved = 0;
  let latestBarDate: string | null = null;

  const BATCH = 5; // polite to Yahoo, same as the trend screener
  for (let i = 0; i < BASKET.length; i += BATCH) {
    const batch = BASKET.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (inst) => {
        const bars = await fetchDailyBars(inst.yahoo);
        if (bars.length < 300) throw new Error(`only ${bars.length} bars (need 300)`);
        const ranges = detectRanges(bars);
        return { inst, bars, analyzed: ranges.map((r) => analyze(inst.symbol, bars, r)) };
      }),
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === "rejected") {
        errors.push({
          instrument: batch[j].symbol,
          message: s.reason instanceof Error ? s.reason.message : String(s.reason),
        });
        continue;
      }
      scanned++;
      const { inst, bars, analyzed } = s.value;
      const last = bars[bars.length - 1]?.date ?? null;
      if (last && (!latestBarDate || last > latestBarDate)) latestBarDate = last;
      rangesFound += analyzed.length;
      for (const a of analyzed) {
        try {
          if (await persistRange(a)) persisted++;
        } catch (e) {
          errors.push({
            instrument: a.candidate.instrument,
            message: `persist failed: ${e instanceof Error ? e.message : e}`,
          });
        }
        if (a.fresh) fresh.push(a.candidate);
      }
      // ── Stale-open sweep ──────────────────────────────────────────────────
      // As bars accumulate, the greedy detector can legitimately re-anchor an
      // open range to a different start date — leaving the previous open row
      // behind as a phantom duplicate (two "OPEN" cards for one instrument).
      // Any open row this scan did NOT re-detect is stale: remove it, unless
      // a read was locked on it (a locked read is immutable evidence — those
      // rows are kept and will simply age out of the readable list).
      try {
        const openStarts = analyzed
          .filter((a) => a.range.status === "open")
          .map((a) => toUtcDate(a.candidate.rangeStartDate));
        const del = await (db as any).scannerCandidate.deleteMany({
          where: {
            instrument: inst.symbol,
            status: "open",
            outcome: null,
            traderVerdict: null,
            rangeStartDate: { notIn: openStarts },
          },
        });
        staleRemoved += del.count ?? 0;
      } catch (e) {
        errors.push({
          instrument: inst.symbol,
          message: `stale-open sweep failed: ${e instanceof Error ? e.message : e}`,
        });
      }
    }
  }

  // Neutral sort only (spec §10): most recent decision point first, then
  // alphabetical. NOT a quality ranking — a score is a verdict in disguise.
  fresh.sort((x, y) => {
    const dx = x.breakoutDate ?? x.lastBarDate;
    const dy = y.breakoutDate ?? y.lastBarDate;
    if (dx !== dy) return dx < dy ? 1 : -1;
    return x.instrument.localeCompare(y.instrument);
  });

  return { candidates: fresh, scanned, rangesFound, persisted, staleRemoved, latestBarDate, errors };
}

// ── §9 Outcome backfill ───────────────────────────────────────────────────────
// Any broken-out row with outcome=null whose breakout is old enough gets its
// outcome computed from the RESOLVE_BARS-th bar after the breakout and stored.
export interface BackfillResult {
  checked: number; // pending rows considered
  updated: number; // outcomes written
  notReady: number; // rows whose resolution window hasn't completed yet
  errors: Array<{ instrument: string; message: string }>;
}

export async function backfillOutcomes(): Promise<BackfillResult> {
  // 12 trading days ≈ 16+ calendar days; use a loose DB pre-filter, then the
  // precise outcomeReady() check against actual bars.
  const cutoff = new Date(Date.now() - 16 * 86_400_000);
  const pending: Array<{
    id: string;
    instrument: string;
    rangeLo: number;
    rangeHi: number;
    breakoutDate: Date;
  }> = await (db as any).scannerCandidate.findMany({
    where: { outcome: null, status: "broken", breakoutDate: { not: null, lte: cutoff } },
    select: { id: true, instrument: true, rangeLo: true, rangeHi: true, breakoutDate: true },
  });

  const result: BackfillResult = { checked: pending.length, updated: 0, notReady: 0, errors: [] };
  if (!pending.length) return result;

  // One fetch per instrument, shared across its pending rows.
  const byInstrument = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byInstrument.get(row.instrument) ?? [];
    list.push(row);
    byInstrument.set(row.instrument, list);
  }

  for (const [instrument, rows] of byInstrument) {
    const inst = BASKET.find((b) => b.symbol === instrument);
    if (!inst) {
      result.errors.push({ instrument, message: "not in basket" });
      continue;
    }
    let bars: Bar[];
    try {
      bars = await fetchDailyBars(inst.yahoo);
    } catch (e) {
      result.errors.push({ instrument, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const idxByDate = new Map(bars.map((b, i) => [b.date, i]));
    for (const row of rows) {
      const key = row.breakoutDate.toISOString().slice(0, 10);
      const end = idxByDate.get(key);
      if (end == null) {
        result.errors.push({ instrument, message: `breakout bar ${key} not found in series` });
        continue;
      }
      if (!outcomeReady(bars.length, end)) {
        result.notReady++;
        continue;
      }
      const o = outcome(bars, end, row.rangeLo, row.rangeHi);
      await (db as any).scannerCandidate.update({
        where: { id: row.id },
        data: { outcome: o, outcomeAt: new Date() },
      });
      result.updated++;
    }
  }
  return result;
}
