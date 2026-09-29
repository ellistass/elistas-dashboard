// lib/swing/outcomes.ts — resolve every logged setup against the bars that
// followed it (lib/swing/simulate.ts), and build the Journal's results table.
//
// Runs nightly after the setup log. Only rows still unresolved ("open" or never
// run) in the last 400 days are re-simulated; one fetch per instrument.

import { db } from "@/lib/db";
import { instrumentInfo } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { fetchSpot } from "@/lib/setups/forexDriver";
import { completedBars } from "@/lib/setups/scan";
import { addDays, todayUtc, type DayBar } from "./core";
import { simulate, stats, type GroupStats, type SimInput } from "./simulate";

const L = () => (db as any).setupLog;

/** The simulation input from a frozen snapshot (futures InstrumentSetup or forex DriverSetup). */
export function simInputFor(row: any): SimInput | null {
  const s = row.snapshot ?? {};
  if (row.market === "forex") {
    const o = s.order;
    if (!o) return null;
    return {
      side: row.side, entryKind: row.firstState === "filled" ? "filled" : "limit",
      entryPrice: o.entry, stop: o.stopLoss, cap: null, firstBarDate: row.firstBarDate, goodFor: o.goodForBars ?? 5,
    };
  }
  const e = s.order?.entry;
  const kind = row.firstState === "filled" ? "filled" : e?.kind === "market-on-open" || row.firstState === "trigger" ? "open" : "limit";
  return {
    side: row.side, entryKind: kind, entryPrice: row.entryPrice, stop: row.stop, cap: row.target ?? null,
    firstBarDate: row.firstBarDate, goodFor: s.barsLeft ?? e?.goodFor ?? 5,
  };
}

/** The grouping tags, copied out of the snapshot so the Journal never loads snapshots. */
export function tagsFor(row: any) {
  const s = row.snapshot ?? {};
  return {
    context: s.context?.daily ?? (row.market === "forex" ? "reversal" : null),   // forex setups are reversal breaks by construction
    cot: s.positioning?.sell?.verdict ?? null,
    quietRetest: typeof s.retest?.low === "boolean" ? s.retest.low : null,
  };
}

async function barsFor(market: string, instrument: string): Promise<DayBar[]> {
  if (market === "forex") return fetchSpot(instrument);
  const inst = instrumentInfo(instrument);
  if (!inst) throw new Error(`${instrument} is not in the basket`);
  return completedBars(await fetchDailyBars(inst.yahoo, "5y"));   // same range as the scan → cache hit
}

export async function resolveOutcomes(): Promise<{ resolved: number; still: number; errors: { instrument: string; error: string }[] }> {
  const rows = await L().findMany({
    where: { firstBarDate: { gte: addDays(todayUtc(), -400) }, OR: [{ outcome: null }, { outcome: "open" }] },
  });
  const groups = new Map<string, any[]>();
  for (const r of rows) groups.set(`${r.market}|${r.instrument}`, [...(groups.get(`${r.market}|${r.instrument}`) ?? []), r]);

  let resolved = 0, still = 0;
  const errors: { instrument: string; error: string }[] = [];
  for (const [key, list] of groups) {
    const [market, instrument] = key.split("|");
    let bars: DayBar[];
    try { bars = await barsFor(market, instrument); }
    catch (e) { errors.push({ instrument, error: e instanceof Error ? e.message : String(e) }); continue; }
    for (const row of list) {
      const input = simInputFor(row);
      if (!input) continue;
      const res = simulate(input, bars);
      await L().update({
        where: { id: row.id },
        data: {
          outcome: res.outcome, fillDate: res.fillDate, fillPrice: res.fillPrice, exitDate: res.exitDate,
          exitPrice: res.exitPrice, exitReason: res.exitReason, resultR: res.resultR, peakR: res.peakR, resolvedAt: new Date(),
          ...tagsFor(row),
        },
      });
      if (res.outcome === "open") still++; else resolved++;
    }
  }
  return { resolved, still, errors };
}

// ── Results table ────────────────────────────────────────────────────────────

export interface ResultRow { group: string; expectation: string; expLo: number | null; expHi: number | null; stats: GroupStats }

const closed = (r: any) => r.outcome === "win" || r.outcome === "loss" || r.outcome === "be";
const byExit = (a: any, b: any) => String(a.exitDate).localeCompare(String(b.exitDate));

/** Groups from the spec's Journal table. Only closed setups count; expired ones never filled. */
export function resultsTable(rows: any[], taken: any[]): ResultRow[] {
  const done = rows.filter(closed).sort(byExit);
  const g = (pred: (r: any) => boolean) => stats(done.filter(pred).map((r) => r.resultR));
  const cot = (r: any) => r.cot;
  const quiet = (r: any) => r.quietRetest === true;
  return [
    { group: "All setups", expectation: "—", expLo: null, expHi: null, stats: g(() => true) },
    { group: "Grade A", expectation: "about +0.35R, streaks about 5", expLo: 0.25, expHi: 0.45, stats: g((r) => r.grade === "A") },
    { group: "Grade B", expectation: "about 0R", expLo: -0.1, expHi: 0.1, stats: g((r) => r.grade === "B") },
    { group: "Futures / stocks: reversal", expectation: "+0.67R in the backtest (rule + reversal)", expLo: 0.57, expHi: 0.76, stats: g((r) => r.market === "futures" && r.context === "reversal") },
    { group: "Futures / stocks: with-trend", expectation: "+0.17R", expLo: 0.1, expHi: 0.25, stats: g((r) => r.market === "futures" && r.context === "with-trend") },
    { group: "Forex: COT trapped", expectation: "+0.34 to +0.48R", expLo: 0.34, expHi: 0.48, stats: g((r) => r.market === "forex" && cot(r) === "trapped") },
    { group: "Forex: COT late", expectation: "−0.16 to −0.39R", expLo: -0.39, expHi: -0.16, stats: g((r) => r.market === "forex" && cot(r) === "late") },
    { group: "Quiet retest", expectation: "+0.28 to +0.48R", expLo: 0.28, expHi: 0.48, stats: g(quiet) },
    {
      group: "Taken by you", expectation: "—", expLo: null, expHi: null,
      stats: stats(taken.filter((t) => t.status === "closed" && t.resultR != null).sort((a, b) => String(a.exitDate).localeCompare(String(b.exitDate))).map((t) => t.resultR)),
    },
  ];
}
