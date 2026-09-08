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
// Dedup: identity is decided by OVERLAP against the rows already held (see
// lib/wyckoff/identity.ts), not by rangeStartDate — that date is a corrigible
// estimate the greedy detector re-anchors as the data window rolls. An open
// range updates in place until it breaks out, then freezes: once status is
// "broken" the verdict is locked and no scan writes to the row again.
//
// A settled row still has to MATCH its own re-detection, though. It stays in
// the bars forever, so a scan that cannot match it creates a fresh copy
// instead — which then resolves and posts an already-months-old success or
// failure to the audit. That was the shape of the bug fixed here: ~785 clones
// per scan.

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
  freshReason,
  type Bar,
  type DetectedRange,
  type TerminalTest,
  type FreshReason,
} from "./engine";
import { gradeRange, packFactors, type RangeGrade } from "./grade";
import { assignRanges, type ExistingRow } from "./identity";
import { computeTiming } from "./timing";

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

// A watched level that a daily bar actually traded through. Trader-side data
// only (your tag, your note, your level) — no verdict, no direction.
export interface WatchAlert {
  instrument: string;
  watch: string; // "now" | "later"
  level: number;
  barDate: string; // the bar that triggered it
  close: number;
  via: "touch" | "gap"; // traded through the level, or gapped clean over it
  note: string | null;
  rangeLo: number;
  rangeHi: number;
}

export interface WyckoffScanResult {
  candidates: Candidate[]; // FRESH only, neutral sort, verdict-free
  alerts: WatchAlert[]; // watched levels touched since the alert was armed
  scanned: number; // instruments successfully fetched
  rangesFound: number; // all ranges across all instruments (persisted)
  persisted: number; // rows written/updated this run
  settled: number; // detections matched to an already-settled row and left alone
  staleRemoved: number; // open rows no longer detected at all
  reanchored: number;   // ranges whose start date moved but kept their row
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
  reason: FreshReason | null; // WHY it is at a decision point
  sparkBars: Array<Array<number | string>>; // compact window for the card chart
  grade: RangeGrade; // structural quality — never a direction call
  testBarDate: string | null; // date of the terminal-test bar, for lead-time math
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
  // Thumbnail window: a little context before the range, then everything to
  // the right edge, capped so the JSON stays small. Dates are kept so the card
  // can locate the range box by date rather than by a stored index that would
  // drift the moment the series shifts.
  const SPARK_MAX = 70;
  const SPARK_CONTEXT = 8;
  const sparkFrom = Math.max(0, Math.min(start - SPARK_CONTEXT, bars.length - SPARK_MAX));
  const sparkBars = bars
    .slice(Math.max(0, sparkFrom), bars.length)
    .slice(-SPARK_MAX)
    .map((b) => [round6(b.o), round6(b.h), round6(b.l), round6(b.c), Math.round(b.v), b.date]);

  const reason = freshReason(bars, range, springIdx, upthrustIdx);
  const testIdx = Math.max(springIdx ?? -1, upthrustIdx ?? -1);
  return {
    range,
    candidate,
    verdict: engineVerdict(bars, start, end),
    // Historical ranges (first backfill of the 2y window) already have their
    // outcome visible in the data at log time — flag them so the strict
    // you-vs-engine benchmark can filter to genuinely blind verdicts.
    loggedBlind: status === "open" || !outcomeReady(bars.length, end),
    fresh: reason != null,
    reason,
    sparkBars,
    testBarDate: testIdx >= 0 ? bars[testIdx].date : null,
    // Structural quality only — see the blind-integrity note in grade.ts.
    grade: gradeRange({
      bars,
      start,
      end,
      lo,
      hi,
      touchesHi: range.touchesHi,
      touchesLo: range.touchesLo,
      springIdx,
      upthrustIdx,
      terminalTest: candidate.terminalTest,
      contextPct: candidate.contextPct,
    }),
  };
}

/** One entry in a candidate's sighting log. */
export interface Sighting {
  /** DATA date the scanner saw it at a decision point (YYYY-MM-DD). */
  barDate: string;
  /** Why it was a decision point that day. */
  reason: FreshReason;
  /** Wall-clock time of the scan that recorded it. */
  at: string;
}

/** Keep the log bounded. A range that has offered itself forty times has
 *  already made its point; the oldest entries are the ones you stop needing. */
const MAX_SIGHTINGS = 40;

/** Append today's sighting, or nothing if this range is not at a decision
 *  point — or was already logged at this data date. */
function buildSighting(row: any, a: AnalyzedRange): Record<string, unknown> {
  if (!a.fresh || !a.reason) return {};
  const barDate = a.candidate.lastBarDate;
  const log: Sighting[] = Array.isArray(row?.sightings) ? (row.sightings as Sighting[]) : [];
  if (log.some((sg) => sg?.barDate === barDate)) return {};
  const next = [...log, { barDate, reason: a.reason, at: new Date().toISOString() }].slice(-MAX_SIGHTINGS);
  // sightingCount counts every sighting ever, so it stays truthful after the
  // log itself has been trimmed.
  return { sightings: next, sightingCount: (row?.sightingCount ?? log.length) + 1 };
}

/**
 * Persist every range detected for ONE instrument in a single pass.
 *
 * Per-instrument rather than per-range because identity is now decided by
 * OVERLAP against the rows we already hold, and that assignment has to be
 * one-to-one. Done a range at a time, two detections could both claim the same
 * row and one would silently overwrite the other.
 *
 * What this fixes: rows were keyed `instrument + rangeStartDate`. The detector
 * re-anchors that start date as the rolling data window shifts, so the same
 * setup forked into a new row — orphaning yesterday's, and stamping today's
 * with a first-seen date that should have been yesterday's.
 */
async function persistInstrument(
  instrument: string,
  analyzed: AnalyzedRange[],
  lastBarDate: string,
): Promise<{ written: number; settled: number; reanchored: number; matchedIds: string[] }> {
  const result = { written: 0, settled: 0, reanchored: 0, matchedIds: [] as string[] };
  if (!analyzed.length) return result;

  const rows = await (db as any).scannerCandidate.findMany({
    where: { instrument },
    select: {
      id: true, status: true, outcome: true, surfacedAt: true,
      rangeStartDate: true, breakoutDate: true, rangeLo: true, rangeHi: true,
      traderVerdict: true, firstSeenBarDate: true, reanchorCount: true,
      sightings: true, sightingCount: true,
    },
  });

  const existing: ExistingRow[] = rows.map((r: any) => ({
    id: r.id,
    startDate: r.rangeStartDate.toISOString().slice(0, 10),
    endDate: (r.breakoutDate ?? toUtcDate(lastBarDate)).toISOString().slice(0, 10),
    lo: r.rangeLo,
    hi: r.rangeHi,
    // SETTLED = the range broke out, or its outcome is already recorded.
    // Those rows are finished: boundaries fixed, engine verdict locked at the
    // breakout, grade final. They still MATCH (see assignRanges) so the
    // detector cannot clone them — they just never get written to again.
    //
    // A locked READ is deliberately NOT settling. The read is a call on a
    // range that is still open; if the row stopped tracking the moment you
    // read it, it would never record its own breakout and never resolve — the
    // read could not be scored at all. There are 13 such rows in the table,
    // stuck open since July for exactly this reason. What the read fixes in
    // place is traderEntry / traderStop / traderVerdict, and no scan writes
    // those.
    frozen: r.status === "broken" || r.outcome != null,
  }));

  const assignments = assignRanges(
    analyzed.map((a) => ({
      startDate: a.candidate.rangeStartDate,
      endDate: a.candidate.breakoutDate ?? lastBarDate,
      lo: a.candidate.rangeLo,
      hi: a.candidate.rangeHi,
      _a: a,
    })),
    existing,
  );

  for (const assn of assignments) {
    const a = (assn.detected as any)._a as AnalyzedRange;
    const row = assn.matchedId ? rows.find((r: any) => r.id === assn.matchedId) : null;

    // A settled row has claimed this detection. Keeping its id in matchedIds is
    // what tells the stale sweep the range is still there; returning here is
    // what stops the clone. Nothing is written.
    if (row && assn.frozen) {
      result.matchedIds.push(row.id);
      result.settled++;
      continue;
    }

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
      rangeStartDate: toUtcDate(a.candidate.rangeStartDate),
      breakoutDate: a.candidate.breakoutDate ? toUtcDate(a.candidate.breakoutDate) : null,
      grade: a.grade.grade,
      gradeScore: a.grade.score,
      gradeFactors: packFactors(a.grade.factors),
      gradeNotes: a.grade.notes,
      touchesHi: a.range.touchesHi,
      touchesLo: a.range.touchesLo,
      rangeConfirmed: a.range.confirmed,
      surfacedReason: a.reason,
      testBarDate: a.testBarDate ? toUtcDate(a.testBarDate) : null,
      sparkBars: a.sparkBars,
    };

    // First-surfaced stamp: written the first time this range reaches a
    // decision point and never again. surfacedBarDate is the DATA date, not
    // the wall clock — a scan that runs late must not make the scanner look
    // late. This survives a re-anchor now, which is the entire point.
    const surfaceStamp =
      a.fresh && !row?.surfacedAt
        ? { surfacedAt: new Date(), surfacedBarDate: toUtcDate(a.candidate.lastBarDate) }
        : {};

    // ── Sighting log ──────────────────────────────────────────────────────
    // surfacedBarDate answers "when did this FIRST become a decision" and is
    // written once. It cannot answer "how many times has this same box come
    // back to its edge while I did nothing about it" — and on a range that
    // sits for weeks, that is the more useful question: the same setup on the
    // same pair, offered again and again, is one thing to judge, not eight
    // unrelated cards.
    //
    // Keyed on the DATA date, so re-running the scan twice in an afternoon
    // logs one sighting, not two.
    const sightingStamp = buildSighting(row, a);

    if (row) {
      // Re-anchor bookkeeping: correct the boundaries, record that they moved,
      // and leave every first-occurrence fact alone.
      const reanchorStamp = assn.reanchored
        ? { reanchorCount: (row.reanchorCount ?? 0) + 1, lastReanchorAt: new Date() }
        : {};
      if (assn.reanchored) result.reanchored++;
      await (db as any).scannerCandidate.update({
        where: { id: row.id },
        data: { ...data, ...surfaceStamp, ...sightingStamp, ...reanchorStamp },
      });
      result.matchedIds.push(row.id);
    } else {
      const created = await (db as any).scannerCandidate.create({
        data: {
          ...data,
          ...surfaceStamp,
          ...sightingStamp,
          instrument,
          outcome: null,
          // Set once, at creation, and never written again anywhere.
          firstSeenBarDate: toUtcDate(a.candidate.lastBarDate),
          originalRangeStart: toUtcDate(a.candidate.rangeStartDate),
        },
        select: { id: true },
      });
      result.matchedIds.push(created.id);
    }
    result.written++;
  }

  return result;
}

/** Full basket sweep: detect → persist ALL → return FRESH (verdict-free). */
export async function runWyckoffScan(): Promise<WyckoffScanResult> {
  const fresh: Candidate[] = [];
  const errors: Array<{ instrument: string; message: string }> = [];
  let scanned = 0;
  let rangesFound = 0;
  let persisted = 0;
  let settledRows = 0;
  let staleRemoved = 0;
  let reanchored = 0;
  let latestBarDate: string | null = null;
  const alerts: WatchAlert[] = [];

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
      let keptIds: string[] = [];
      try {
        const res = await persistInstrument(inst.symbol, analyzed, last ?? "");
        persisted += res.written;
        settledRows += res.settled;
        reanchored += res.reanchored;
        keptIds = res.matchedIds;
      } catch (e) {
        errors.push({
          instrument: inst.symbol,
          message: `persist failed: ${e instanceof Error ? e.message : e}`,
        });
      }
      for (const a of analyzed) if (a.fresh) fresh.push(a.candidate);
      // ── Stale-open sweep ──────────────────────────────────────────────────
      // As bars accumulate, the greedy detector can legitimately re-anchor an
      // open range to a different start date — leaving the previous open row
      // behind as a phantom duplicate (two "OPEN" cards for one instrument).
      // Any open row this scan did NOT re-detect is stale: remove it, unless
      // a read was locked on it (a locked read is immutable evidence — those
      // rows are kept and will simply age out of the readable list).
      try {
        // Sweep by ID now. Identity is decided by overlap, so a re-anchored
        // range comes back as a MATCH and keeps its row — testing start dates
        // here would delete rows this same scan just updated.
        const del = await (db as any).scannerCandidate.deleteMany({
          where: {
            instrument: inst.symbol,
            status: "open",
            outcome: null,
            traderVerdict: null,
            watch: null, // triaged rows are yours — the sweep never takes them
            id: { notIn: keptIds },
          },
        });
        staleRemoved += del.count ?? 0;
      } catch (e) {
        errors.push({
          instrument: inst.symbol,
          message: `stale-open sweep failed: ${e instanceof Error ? e.message : e}`,
        });
      }

      // ── Watchlist alert check ─────────────────────────────────────────────
      // Bars for this instrument are already in hand, so the check is free:
      // no extra fetch, no separate cron, no intraday polling.
      try {
        alerts.push(...(await fireWatchAlerts(inst.symbol, bars)));
      } catch (e) {
        errors.push({
          instrument: inst.symbol,
          message: `watch alert check failed: ${e instanceof Error ? e.message : e}`,
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

  alerts.sort((a, b) => (a.watch === b.watch ? a.instrument.localeCompare(b.instrument) : a.watch === "now" ? -1 : 1));

  return { candidates: fresh, alerts, scanned, rangesFound, persisted, settled: settledRows, staleRemoved, reanchored, latestBarDate, errors };
}

// ── Watchlist alerts ─────────────────────────────────────────────────────────
// Fires when a daily bar's range contains the level you set on the chart.
//
// Only bars STRICTLY AFTER the arm day count: setting a level at a price today
// already traded is not news, and letting it fire immediately would train you
// to ignore the alert. One shot per arming — alertHitAt is stamped and the row
// goes quiet until you move or re-set the level.
async function fireWatchAlerts(instrument: string, bars: Bar[]): Promise<WatchAlert[]> {
  const armed: Array<{
    id: string;
    watch: string | null;
    watchNote: string | null;
    alertPrice: number | null;
    alertSetAt: Date | null;
    rangeLo: number;
    rangeHi: number;
  }> = await (db as any).scannerCandidate.findMany({
    where: { instrument, outcome: null, alertPrice: { not: null }, alertHitAt: null },
    select: {
      id: true, watch: true, watchNote: true, alertPrice: true,
      alertSetAt: true, rangeLo: true, rangeHi: true,
    },
  });
  if (!armed.length) return [];

  const hits: WatchAlert[] = [];
  for (const row of armed) {
    const level = row.alertPrice;
    if (level == null) continue;
    const armedDay = row.alertSetAt ? row.alertSetAt.toISOString().slice(0, 10) : null;

    // Walk forward from the arm day. A level counts as reached when the bar
    // TRADED through it (low <= level <= high) — or when price GAPPED clean
    // over it (previous close one side, this close the other). Without the gap
    // case an overnight jump through your level would leave the alert armed
    // forever, silent on exactly the move worth knowing about.
    let prevClose: number | null = null;
    let hit: { bar: Bar; via: "touch" | "gap" } | null = null;
    for (const b of bars) {
      if (armedDay != null && b.date <= armedDay) { prevClose = b.c; continue; }
      if (b.l <= level && level <= b.h) { hit = { bar: b, via: "touch" }; break; }
      if (prevClose != null && (prevClose - level) * (b.c - level) < 0) {
        hit = { bar: b, via: "gap" };
        break;
      }
      prevClose = b.c;
    }
    if (!hit) continue;
    const touch = hit.bar;
    await (db as any).scannerCandidate.update({
      where: { id: row.id },
      data: { alertHitAt: new Date(), alertHitDate: toUtcDate(touch.date) },
    });
    hits.push({
      instrument,
      watch: row.watch ?? "later",
      level,
      barDate: touch.date,
      close: touch.c,
      via: hit.via,
      note: row.watchNote,
      rangeLo: row.rangeLo,
      rangeHi: row.rangeHi,
    });
  }
  return hits;
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
    surfacedBarDate: Date | null;
    testBarDate: Date | null;
  }> = await (db as any).scannerCandidate.findMany({
    where: { outcome: null, status: "broken", breakoutDate: { not: null, lte: cutoff } },
    select: {
      id: true, instrument: true, rangeLo: true, rangeHi: true, breakoutDate: true,
      // Needed to compute lead time at the same moment the outcome lands — the
      // bars are already fetched here, so doing it anywhere else would mean a
      // second round trip to Yahoo for data we are already holding.
      surfacedBarDate: true, testBarDate: true,
    },
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
      // Lead time in TRADING days, measured from the data date the range first
      // reached a decision point. Null for rows that surfaced before timing
      // tracking existed — there is no honest way to invent that date.
      const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
      const { leadToBreakout, leadToTest } = computeTiming({
        bars,
        surfacedBarDate: iso(row.surfacedBarDate),
        breakoutDate: iso(row.breakoutDate),
        testBarDate: iso(row.testBarDate),
      });
      await (db as any).scannerCandidate.update({
        where: { id: row.id },
        data: { outcome: o, outcomeAt: new Date(), leadToBreakout, leadToTest },
      });
      result.updated++;
    }
  }
  return result;
}
