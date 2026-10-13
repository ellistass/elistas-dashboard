// lib/swing/filled.ts — every logged setup played out under the card's rules, live.
//
// A setup leaves /setups the bar after it fills ("it's a trade now, not a setup").
// This replays the last LOOKBACK_DAYS of logged setups against today's completed
// bars — the same simulate() the Journal runs nightly, run live here — and sorts
// them: open, won, lost, breakeven, never filled. Charts are fetched one at a time.

import { db } from "@/lib/db";
import { instrumentInfo } from "@/lib/wyckoff/basket";
import { addDays, todayUtc, type DayBar } from "./core";
import { barsFor, simInputFor } from "./outcomes";
import { simulate, type SimResult } from "./simulate";

const LOOKBACK_DAYS = 120;   // simulate caps a hold at 60 bars ≈ 85 calendar days

export type FilledStatus = "open" | "win" | "loss" | "be" | "expired";

export interface FilledRow {
  id: string; market: string; instrument: string; executeSymbol: string; inverted: boolean;
  side: string; entry: string; grade: string; status: FilledStatus;
  rangeLo: number; rangeHi: number; rangeStart: string; signalDate: string | null; firstBarDate: string;
  entryPrice: number; origStop: number; target: number | null;
  fillDate: string | null; fillPrice: number | null;
  /** Stop for the next session; stopPrev = what it was before the last close. null = n/a. */
  stopNow: number | null; stopPrev: number | null; stopMoved: boolean; newFill: boolean;
  /** R the current stop locks in: −1 = full risk, 0 = breakeven, >0 = profit locked. */
  lockedR: number | null;
  lastDate: string | null; lastClose: number | null;
  openR: number | null; peakR: number | null; barsHeld: number;
  exitDate: string | null; exitPrice: number | null; exitReason: string | null; resultR: number | null;
  taken: { account: string; status: string } | null;
}

export interface FilledChart {
  row: FilledRow;
  candles: [string, number, number, number, number][];
  /** The stop in force on each bar from the fill on (the trail, step by step). */
  stops: { date: string; stop: number }[];
}

function evaluate(row: any, bars: DayBar[], taken: FilledRow["taken"]): { r: FilledRow; sim: SimResult } | null {
  const input = simInputFor(row);
  if (!input) return null;
  const sim = simulate(input, bars);
  if (sim.outcome === "open" && !sim.fillDate) return null;               // still waiting for its fill: that's /setups
  const open = sim.outcome === "open";
  const prev = open ? simulate(input, bars.slice(0, -1)) : null;          // as of the close before
  const d = row.side === "long" ? 1 : -1;
  const R = sim.fillPrice != null ? Math.abs(sim.fillPrice - input.stop) : 0;
  const stopNow = open ? sim.stopNow ?? null : null;
  const stopPrev = prev && prev.outcome === "open" && prev.fillDate ? prev.stopNow ?? null : null;
  const inst = row.market === "futures" ? instrumentInfo(row.instrument) : undefined;
  const fillDate = sim.fillDate;
  return {
    sim,
    r: {
      id: row.id, market: row.market, instrument: row.instrument,
      executeSymbol: inst?.executeSymbol || row.instrument, inverted: inst?.inverted ?? false,
      side: row.side, entry: row.entry, grade: row.grade, status: sim.outcome,
      rangeLo: row.rangeLo, rangeHi: row.rangeHi, rangeStart: row.rangeStart, signalDate: row.signalDate, firstBarDate: row.firstBarDate,
      entryPrice: input.entryPrice, origStop: input.stop, target: input.cap,
      fillDate, fillPrice: sim.fillPrice,
      stopNow, stopPrev,
      stopMoved: stopNow != null && stopPrev != null && Math.abs(stopNow - stopPrev) > 1e-9,
      newFill: open && !prev?.fillDate,
      lockedR: stopNow != null && R > 0 && sim.fillPrice != null ? +((d * (stopNow - sim.fillPrice)) / R).toFixed(2) : null,
      lastDate: bars.at(-1)?.date ?? null, lastClose: bars.at(-1)?.c ?? null,
      openR: open ? sim.resultR : null, peakR: sim.peakR,
      barsHeld: fillDate ? bars.filter((b) => b.date >= fillDate && (!sim.exitDate || b.date <= sim.exitDate)).length : 0,
      exitDate: sim.exitDate, exitPrice: sim.exitPrice, exitReason: sim.exitReason, resultR: open ? null : sim.resultR,
      taken,
    },
  };
}

async function takenFor(ids: string[]) {
  const taken = await (db as any).swingTrade.findMany({
    where: { setupLogId: { in: ids } }, select: { setupLogId: true, account: true, status: true },
  });
  return new Map<string, { account: string; status: string }>(
    taken.map((t: any) => [t.setupLogId, { account: t.account, status: t.status }]));
}

export async function filledSetups(): Promise<{ rows: FilledRow[]; errors: { instrument: string; error: string }[] }> {
  const logs = await (db as any).setupLog.findMany({ where: { firstBarDate: { gte: addDays(todayUtc(), -LOOKBACK_DAYS) } } });
  const takenBy = await takenFor(logs.map((r: any) => r.id));

  const groups = new Map<string, any[]>();
  for (const r of logs) {
    const k = `${r.market}|${r.instrument}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rows: FilledRow[] = [];
  const errors: { instrument: string; error: string }[] = [];
  for (const [k, list] of groups) {
    const [market, instrument] = k.split("|");
    let bars: DayBar[];
    try { bars = await barsFor(market, instrument); }
    catch (e) { errors.push({ instrument, error: e instanceof Error ? e.message : String(e) }); continue; }
    for (const row of list) {
      const ev = evaluate(row, bars, takenBy.get(row.id) ?? null);
      if (ev) rows.push(ev.r);
    }
  }
  // Newest action first: open by fill date, closed by exit date, never-filled by when it was seen.
  const key = (r: FilledRow) => r.exitDate ?? r.fillDate ?? r.firstBarDate;
  rows.sort((a, b) => key(b).localeCompare(key(a)));
  return { rows, errors };
}

/** One setup with its chart: ~10 bars before the range through the exit (+8), capped at 160. */
export async function filledChart(id: string): Promise<FilledChart | null> {
  const row = await (db as any).setupLog.findUnique({ where: { id } });
  if (!row) return null;
  const bars = await barsFor(row.market, row.instrument);
  const takenBy = await takenFor([id]);
  const ev = evaluate(row, bars, takenBy.get(id) ?? null);
  if (!ev) return null;
  const idx = (date: string) => { const i = bars.findIndex((b) => b.date >= date); return i < 0 ? bars.length - 1 : i; };
  const end = ev.r.exitDate ? Math.min(bars.length, idx(ev.r.exitDate) + 9) : bars.length;
  const from = Math.max(0, end - 160, Math.min(idx(row.rangeStart) - 10, end - 40));
  return {
    row: ev.r,
    candles: bars.slice(from, end).map((b) => [b.date, b.o, b.h, b.l, b.c]),
    stops: ev.sim.stops ?? [],
  };
}
