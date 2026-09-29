// app/api/swing/month/route.ts — is this month on plan?
//
// GET ?month=YYYY-MM → {
//   accounts: per account — plan (risk, stop, target, grades) + ledger
//   setups:   seen / filled / expired / taken / skipped, per market, from the setup log
//   score:    the Discipline score for the month
//   calendar: your event dates + COT release nights + US clock changes
// }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledger, todayUtc } from "@/lib/swing/core";
import { loadAccounts } from "@/lib/swing/trades";
import { monthScore } from "@/lib/swing/discipline";

const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();
function daysOf(month: string): string[] {
  const out: string[] = [];
  for (let d = new Date(month + "-01T00:00:00Z"); d.toISOString().startsWith(month); d = new Date(d.getTime() + 864e5)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const nthSunday = (days: string[], n: number) => days.filter((d) => dow(d) === 0)[n - 1];

/** Fixed dates the spec asks for: COT nights and the US clock changes that move the closes. */
function fixedDates(month: string) {
  const days = daysOf(month);
  const out: { date: string; symbol: string; type: string; note: string }[] = [];
  for (const d of days) if (dow(d) === 5) out.push({ date: d, symbol: "COT", type: "cot", note: "CFTC positioning out 20:30 Lagos — the forex COT read updates" });
  if (month.endsWith("-11")) {
    const d = nthSunday(days, 1);
    if (d) out.push({ date: d, symbol: "US", type: "clock", note: "US clocks back — closes move to 22:00 stocks / 23:00 forex (Lagos)" });
  }
  if (month.endsWith("-03")) {
    const d = nthSunday(days, 2);
    if (d) out.push({ date: d, symbol: "US", type: "clock", note: "US clocks forward — closes move to 21:00 stocks / 22:00 forex (Lagos)" });
  }
  return out;
}

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const month = new URL(req.url).searchParams.get("month") ?? todayUtc().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    const from = `${month}-01`, to = `${month}-31`;
    const [accounts, trades, logs, skips, events, score] = await Promise.all([
      loadAccounts(),
      (db as any).swingTrade.findMany({ where: { OR: [{ status: "open" }, { exitDate: { gte: from, lte: to } }, { entryDate: { gte: from, lte: to } }] } }),
      (db as any).setupLog.findMany({ where: { firstBarDate: { gte: from, lte: to } }, select: { id: true, market: true, firstState: true, lastState: true, goneAt: true } }).catch(() => []),
      (db as any).disciplineEvent.findMany({ where: { kind: "skip", date: { gte: from, lte: to } }, select: { setupLogId: true, instrument: true } }).catch(() => []),
      (db as any).tradingEvent.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: "asc" } }).catch(() => []),
      monthScore(month),
    ]);

    const acc = accounts.map((a) => {
      const L = ledger(a, trades, month);
      const closed = trades.filter((t: any) => t.account === a.key && t.status === "closed" && t.exitDate >= from && t.exitDate <= to);
      return { ...a, ledger: L, closed: closed.length, closedR: closed.reduce((s: number, t: any) => s + (t.resultR ?? 0), 0) };
    });

    const takenIds = new Set(trades.filter((t: any) => t.setupLogId).map((t: any) => t.setupLogId));
    const skippedIds = new Set(skips.map((s: any) => s.setupLogId).filter(Boolean));
    const count = (market: string) => {
      const rows = logs.filter((r: any) => market === "all" || r.market === market);
      const filled = rows.filter((r: any) => r.firstState === "filled" || r.lastState === "filled");
      return {
        seen: rows.length,
        filled: filled.length,
        expired: rows.filter((r: any) => r.goneAt && !(r.firstState === "filled" || r.lastState === "filled")).length,
        taken: rows.filter((r: any) => takenIds.has(r.id)).length,
        skipped: rows.filter((r: any) => skippedIds.has(r.id)).length,
      };
    };

    const calendar = [...events.map((e: any) => ({ date: e.date, symbol: e.symbol, type: e.type, note: e.note ?? "" })), ...fixedDates(month)]
      .sort((a, b) => a.date.localeCompare(b.date));

    const closedTrades = trades
      .filter((t: any) => t.status === "closed" && t.exitDate >= from && t.exitDate <= to)
      .sort((a: any, b: any) => a.exitDate.localeCompare(b.exitDate))
      .map((t: any) => ({ account: t.account, instrument: t.instrument, side: t.side, exitDate: t.exitDate, resultR: t.resultR, pnlUsd: t.pnlUsd }));

    return NextResponse.json({
      month,
      closedTrades,
      accounts: acc,
      setups: { all: count("all"), futures: count("futures"), forex: count("forex"), skipsWithoutSetup: skips.filter((s: any) => !s.setupLogId).length },
      score,
      calendar,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
