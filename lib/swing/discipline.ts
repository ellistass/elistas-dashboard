// lib/swing/discipline.ts — the rule-break log, the skip log and the monthly
// discipline score. Scored separately from profit: the backtest edge only holds
// if the rules are followed.
//
// Score (per month):
//   placed as the card  — trades entered this month with no Levels break
//   stop moves by rule  — moves that matched the rule stop, against moves + missed evenings
//   planned exits kept  — event exits taken by the planned date, against those missed
//   skips logged        — setups passed on, with a reason

import { db } from "@/lib/db";
import type { Rule } from "./gate";

const E = () => (db as any).disciplineEvent;

export async function logBreak(b: {
  date: string; instrument: string; rule: Rule | string; detail: string;
  tradeId?: string | null; setupLogId?: string | null; auto?: boolean; costR?: number | null;
}) {
  return E().create({
    data: {
      kind: "break", date: b.date, instrument: b.instrument, rule: b.rule, detail: b.detail,
      tradeId: b.tradeId ?? null, setupLogId: b.setupLogId ?? null, auto: !!b.auto, costR: b.costR ?? null,
    },
  });
}

export interface Score {
  month: string;
  placed: { ok: number; total: number };
  stopMoves: { ok: number; total: number };
  exits: { ok: number; total: number };
  skips: number;
  breaks: number;
  unreviewed: number;
}

export async function monthScore(month: string): Promise<Score> {
  const from = `${month}-01`, to = `${month}-31`;
  const [trades, events] = await Promise.all([
    (db as any).swingTrade.findMany({ where: { OR: [{ entryDate: { gte: from, lte: to } }, { status: "open" }, { exitDate: { gte: from, lte: to } }, { plannedExitDate: { gte: from, lte: to } }] } }),
    E().findMany({ where: { date: { gte: from, lte: to } } }),
  ]);
  const breaks = events.filter((e: any) => e.kind === "break");
  const brokeLevels = new Set(breaks.filter((e: any) => e.rule === "Levels" && e.tradeId).map((e: any) => e.tradeId));

  const entered = trades.filter((t: any) => t.entryDate >= from && t.entryDate <= to);
  const placed = { ok: entered.filter((t: any) => !brokeLevels.has(t.id)).length, total: entered.length };

  const moves = trades.flatMap((t: any) => ((t.stopMoves ?? []) as any[]).filter((m) => m.date >= from && m.date <= to));
  const missedMoves = breaks.filter((e: any) => e.rule === "Management").length;
  const stopMoves = { ok: moves.filter((m: any) => m.byRule).length, total: moves.length + missedMoves };

  const planned = trades.filter((t: any) => t.plannedExitDate && t.plannedExitDate >= from && t.plannedExitDate <= to);
  const kept = planned.filter((t: any) => t.status === "closed" && t.exitDate && t.exitDate <= t.plannedExitDate).length;
  const missedExits = breaks.filter((e: any) => e.rule === "Exits").length;
  const exits = { ok: kept, total: kept + missedExits };

  return {
    month, placed, stopMoves, exits,
    skips: events.filter((e: any) => e.kind === "skip").length,
    breaks: breaks.length,
    unreviewed: breaks.filter((e: any) => !e.reviewedAt).length,
  };
}
