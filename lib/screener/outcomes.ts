// lib/screener/outcomes.ts — automatic outcome tracking for screener signals.
//
// Zero manual input: every past ScanResult with a direction gets graded by
// later scans using the candles the nightly sweep already fetched. R is the
// forward move in ATR(14)-at-signal-time units, signed relative to the scanned
// direction (positive = the call was right). Trend signals want positive R;
// climax signals want NEGATIVE R (the reversal thesis). Over 30+ signals per
// bucket this answers: do A-grades beat B? Do fresh beat established? Does the
// climax hook actually precede reversals — and is 50 the right threshold?

import { db } from "@/lib/db";
import type { Candle } from "./yahoo";

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface EvalSummary {
  checked: number;
  updated: number;
  completed: number; // rows that reached the full 30-bar window this run
}

export async function evaluateOutcomes(candlesBySymbol: Map<string, Candle[]>): Promise<EvalSummary> {
  // Rows still inside their 30-bar window. 3mo of candle history covers ~45
  // days back; older unevaluated rows are left alone (candles no longer reach).
  const pending = await db.scanResult.findMany({
    where: {
      direction: { in: ["long", "short"] },
      evaluatedAt: null,
      createdAt: { gte: new Date(Date.now() - 45 * 86_400_000) },
    },
    select: {
      id: true,
      symbol: true,
      direction: true,
      lastClose: true,
      atrPct: true,
      createdAt: true,
      evalBars: true,
      rFwd5: true,
      rFwd15: true,
      rFwd30: true,
    },
  });

  const summary: EvalSummary = { checked: pending.length, updated: 0, completed: 0 };

  for (const row of pending) {
    const candles = candlesBySymbol.get(row.symbol);
    if (!candles?.length) continue;

    // First H4 bucket strictly after the scan ran.
    const signalMs = row.createdAt.getTime();
    const startIdx = candles.findIndex((c) => c.time * 1000 > signalMs);
    if (startIdx < 0) continue;

    const fwd = candles.slice(startIdx, startIdx + 30);
    if (fwd.length <= row.evalBars) continue; // nothing new since last evaluation

    const sign = row.direction === "long" ? 1 : -1;
    const atr = (row.atrPct / 100) * row.lastClose;
    if (!atr || !row.lastClose) continue;
    const r = (px: number) => round2((sign * (px - row.lastClose)) / atr);

    const data: Record<string, unknown> = { evalBars: fwd.length };
    if (fwd.length >= 5 && row.rFwd5 == null) data.rFwd5 = r(fwd[4].close);
    if (fwd.length >= 15 && row.rFwd15 == null) data.rFwd15 = r(fwd[14].close);
    if (fwd.length >= 30 && row.rFwd30 == null) {
      data.rFwd30 = r(fwd[29].close);
      // MFE/MAE across the full window: best/worst R using wick extremes.
      let mfe = -Infinity;
      let mae = Infinity;
      for (const c of fwd) {
        const hi = r(sign === 1 ? c.high : c.low); // favourable extreme
        const lo = r(sign === 1 ? c.low : c.high); // adverse extreme
        if (hi > mfe) mfe = hi;
        if (lo < mae) mae = lo;
      }
      data.mfe30 = round2(mfe);
      data.mae30 = round2(mae);
      data.evaluatedAt = new Date();
      summary.completed++;
    }

    await db.scanResult.update({ where: { id: row.id }, data });
    summary.updated++;
  }

  return summary;
}

// ── Aggregated performance stats for the dashboard ───────────────────────────

export interface StatBucket {
  key: string; // e.g. "trend/A", "climax/all"
  signals: number; // fully evaluated rows
  hitRate: number; // % with rFwd30 > 0 (in the called direction)
  avgR5: number | null;
  avgR15: number | null;
  avgR30: number | null;
  avgMfe: number | null;
  avgMae: number | null;
}

export async function outcomeStats(): Promise<StatBucket[]> {
  const rows = await db.scanResult.findMany({
    where: { evaluatedAt: { not: null } },
    select: { condition: true, grade: true, phase: true, rFwd5: true, rFwd15: true, rFwd30: true, mfe30: true, mae30: true },
  });

  const buckets = new Map<string, typeof rows>();
  const push = (key: string, row: (typeof rows)[number]) => {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  };

  for (const row of rows) {
    if (row.condition === "trend") {
      push(`trend/${row.grade}`, row);
      push(`trend/${row.phase}`, row);
    } else if (row.phase === "climax") {
      push("climax/all", row);
    } else if (row.condition === "big-range") {
      push("big-range/all", row);
    } else if (row.condition === "transition") {
      push("transition/all", row);
    }
  }

  const avg = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x != null);
    return v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  return [...buckets.entries()]
    .map(([key, group]) => ({
      key,
      signals: group.length,
      hitRate: round2((100 * group.filter((g) => (g.rFwd30 ?? 0) > 0).length) / group.length),
      avgR5: avg(group.map((g) => g.rFwd5)),
      avgR15: avg(group.map((g) => g.rFwd15)),
      avgR30: avg(group.map((g) => g.rFwd30)),
      avgMfe: avg(group.map((g) => g.mfe30)),
      avgMae: avg(group.map((g) => g.mae30)),
    }))
    .sort((a, b) => b.signals - a.signals);
}
