// lib/swing/filled.ts — filled setups still in play, managed live under the card's rules.
//
// A setup leaves /setups the bar after it fills ("it's a trade now, not a setup").
// This replays recent logged setups against today's completed bars — the same
// simulate() the Journal runs nightly, run live here — and keeps the ones that
// filled and are still open, or closed in the last few days.

import { db } from "@/lib/db";
import { instrumentInfo } from "@/lib/wyckoff/basket";
import { addDays, todayUtc, type DayBar } from "./core";
import { barsFor, simInputFor } from "./outcomes";
import { simulate } from "./simulate";

const LOOKBACK_DAYS = 120;   // simulate caps a hold at 60 bars ≈ 85 calendar days
const RECENT_EXIT_DAYS = 5;  // a just-closed fill stays on the page this long

export interface FilledRow {
  id: string; market: string; instrument: string; executeSymbol: string; inverted: boolean;
  side: string; entry: string; grade: string;
  fillDate: string; fillPrice: number; origStop: number;
  status: "open" | "closed";
  /** Stop for the next session; stopPrev = what it was before the last close. null = n/a. */
  stopNow: number | null; stopPrev: number | null; stopMoved: boolean; newFill: boolean;
  /** R the current stop locks in: −1 = full risk, 0 = breakeven, >0 = profit locked. */
  lockedR: number | null;
  lastDate: string | null; lastClose: number | null;
  openR: number | null; peakR: number | null; barsHeld: number;
  exitDate: string | null; exitPrice: number | null; exitReason: string | null; resultR: number | null;
  taken: { account: string; status: string } | null;
}

export async function filledSetups(): Promise<{ rows: FilledRow[]; errors: { instrument: string; error: string }[] }> {
  const L = (db as any).setupLog;
  const recentExit = addDays(todayUtc(), -RECENT_EXIT_DAYS);
  const logs = await L.findMany({
    where: {
      firstBarDate: { gte: addDays(todayUtc(), -LOOKBACK_DAYS) },
      OR: [{ outcome: null }, { outcome: "open" }, { exitDate: { gte: recentExit } }],
    },
  });
  const taken = await (db as any).swingTrade.findMany({
    where: { setupLogId: { in: logs.map((r: any) => r.id) } },
    select: { setupLogId: true, account: true, status: true },
  });
  const takenBy = new Map<string, { account: string; status: string }>(
    taken.map((t: any) => [t.setupLogId, { account: t.account, status: t.status }]));

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
    const inst = market === "futures" ? instrumentInfo(instrument) : undefined;

    for (const row of list) {
      const input = simInputFor(row);
      if (!input) continue;
      const now = simulate(input, bars);
      if (!now.fillDate || now.fillPrice == null) continue;                    // waiting or never filled
      const open = now.outcome === "open";
      if (!open && (now.exitDate ?? "") < recentExit) continue;

      const prev = simulate(input, bars.slice(0, -1));                         // as of the close before
      const d = row.side === "long" ? 1 : -1;
      const R = Math.abs(now.fillPrice - input.stop);
      const stopNow = open ? now.stopNow ?? null : null;
      const stopPrev = prev.outcome === "open" && prev.fillDate ? prev.stopNow ?? null : null;
      const fillDate = now.fillDate;

      rows.push({
        id: row.id, market, instrument,
        executeSymbol: inst?.executeSymbol || instrument, inverted: inst?.inverted ?? false,
        side: row.side, entry: row.entry, grade: row.grade,
        fillDate, fillPrice: now.fillPrice, origStop: input.stop,
        status: open ? "open" : "closed",
        stopNow, stopPrev,
        stopMoved: stopNow != null && stopPrev != null && Math.abs(stopNow - stopPrev) > 1e-9,
        newFill: open && !prev.fillDate,
        lockedR: stopNow != null && R > 0 ? +((d * (stopNow - now.fillPrice)) / R).toFixed(2) : null,
        lastDate: now.lastDate ?? bars.at(-1)?.date ?? null, lastClose: now.lastClose ?? bars.at(-1)?.c ?? null,
        openR: open ? now.resultR : null, peakR: now.peakR,
        barsHeld: bars.filter((b) => b.date >= fillDate).length,
        exitDate: now.exitDate, exitPrice: now.exitPrice, exitReason: now.exitReason, resultR: open ? null : now.resultR,
        taken: takenBy.get(row.id) ?? null,
      });
    }
  }
  rows.sort((a, b) => (a.status === b.status ? b.fillDate.localeCompare(a.fillDate) : a.status === "open" ? -1 : 1));
  return { rows, errors };
}
