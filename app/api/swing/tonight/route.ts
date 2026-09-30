// app/api/swing/tonight/route.ts — everything the evening routine needs, in one call.
//
// GET → {
//   today, closes      — tonight's closes in Lagos (DST-aware)
//   accounts           — per account: plan + ledger (open risk, slots, stop room, pot)
//   trades, actions    — open trades (with recent candles) and what each needs tonight
//   actNow             — setups filled on the last bar or triggering at the next open (chart-ready)
//   working            — limit orders working and forex breaks waiting on tonight's close,
//                        closest to filling first
//   alerts             — unreviewed rule breaks
//   missingEarnings, upcoming — event housekeeping
// }
// Reads the STORED scans (never rescans here) so the page opens instantly.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { accountsForGrade, addDays, ledger, monthOf, riskForGrade, specClass, todayUtc } from "@/lib/swing/core";
import { actionsFor, loadAccounts } from "@/lib/swing/trades";
import { symbolsFor } from "@/lib/swing/events";

const nyHour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });

/** Lagos (UTC+1, no DST) time of the 16:00 NY stock close and 17:00 NY forex close. */
function closeTimes(now = new Date()) {
  const off = (now.getUTCHours() - +nyHour.format(now) + 24) % 24;     // 4 in NY summer, 5 in winter
  const lagos = (h: number) => `${String((h + off + 1) % 24).padStart(2, "0")}:00`;
  return [{ label: "Stocks close", at: lagos(16) }, { label: "Forex close", at: lagos(17) }];
}

type Candle = [string, number, number, number, number];
/** Futures bars are [o,h,l,c,v,date]; forex bars are [o,h,l,c,date]. → [date,o,h,l,c] */
const toCandles = (bars: any[] = [], n = 40): Candle[] =>
  bars.slice(-n).map((b) => (b.length === 6 ? [b[5], b[0], b[1], b[2], b[3]] : [b[4], b[0], b[1], b[2], b[3]]) as Candle);

export async function GET() {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const today = todayUtc();
    const month = monthOf(today);
    const [accounts, trades, scans, unreviewed, events] = await Promise.all([
      loadAccounts(),
      (db as any).swingTrade.findMany({ where: { OR: [{ status: "open" }, { status: "closed", exitDate: { gte: `${month}-01` } }] }, orderBy: { entryDate: "asc" } }),
      (db as any).setupScanCache.findMany().catch(() => []),
      (db as any).disciplineEvent.findMany({ where: { kind: "break", reviewedAt: null }, orderBy: { date: "desc" } }).catch(() => []),
      (db as any).tradingEvent.findMany({ where: { date: { gte: today, lte: addDays(today, 120) } }, orderBy: { date: "asc" } }).catch(() => []),
    ]);
    const open = trades.filter((t: any) => t.status === "open");
    const inTrade = new Set(open.map((t: any) => t.instrument));
    const fut = scans.find((x: any) => x.key === "futures");
    const fx = scans.find((x: any) => x.key === "forex");

    const actNow: any[] = [];
    const working: any[] = [];

    for (const s of (fut?.payload as any)?.setups ?? []) {
      const long = s.inverted ? s.side !== "long" : s.side === "long";
      const candles = toCandles(s.bars);
      const last = candles[candles.length - 1]?.[4] ?? null;
      const base = {
        market: "futures", instrument: s.instrument, executeSymbol: s.executeSymbol || null, side: long ? "long" : "short",
        grade: s.grade, inverted: !!s.inverted, inTrade: inTrade.has(s.instrument), last,
      };
      if (s.state === "armed") {
        working.push({ ...base, kind: "limit", level: s.entryPrice, stop: s.stop, left: s.barsLeft ?? 0, total: s.order?.entry?.goodFor ?? s.barsLeft ?? 0,
          closes: candles.map((c) => c[4]), away: last ? (Math.abs(s.entryPrice - last) / last) * 100 : null });
        continue;
      }
      const px = (x: number) => (s.inverted ? 1 / x : x);
      const R = Math.abs(s.entryPrice - s.stop);
      actNow.push({
        ...base, state: s.state, entryKind: s.entry === "aggressive" ? "open" : "limit",
        entry: s.entryPrice, stop: s.stop, cap: s.target, breakeven: s.breakevenAt, candles,
        rNow: s.state === "filled" && last != null && R > 0 ? ((s.side === "long" ? 1 : -1) * (last - s.entryPrice)) / R : null,
        risk: riskForGrade(s.grade), accounts: accountsForGrade(s.grade, accounts), reward: R > 0 ? Math.abs(s.target - s.entryPrice) / R : null,
        take: {
          ref: { market: "futures", instrument: s.instrument, side: s.side, entry: s.entry, rangeLo: s.rangeLo, rangeHi: s.rangeHi },
          instrument: s.instrument, executeSymbol: s.executeSymbol || null, side: long ? "long" : "short", grade: s.grade,
          entry: px(s.entryPrice), stop: px(s.stop), cap: px(s.target), entryKind: s.entry === "aggressive" ? "open" : "limit",
          samePrices: s.assetClass === "stock", readLocked: null, readAgrees: null,
          entryDate: s.state === "filled" ? s.lastBarDate : today,
        },
      });
    }

    for (const s of (fx?.payload as any)?.setups ?? []) {
      if (s.skip) continue;                                             // COT not trapped / selling USD: not a trade
      const candles = toCandles(s.bars);
      const last = candles[candles.length - 1]?.[4] ?? null;
      const base = { market: "forex", instrument: s.pair, executeSymbol: null, side: s.side, grade: s.grade, inverted: false, inTrade: inTrade.has(s.pair), last };
      if (s.state === "watch" || s.state === "armed") {
        const level = s.state === "watch" ? s.breakLevel : s.order.entry;
        working.push({ ...base, kind: s.state === "watch" ? "close" : "limit", level, stop: s.order.stopLoss,
          left: s.state === "armed" ? s.order.goodForBars : 0, total: s.state === "armed" ? s.order.goodForBars : 0,
          closes: candles.map((c) => c[4]), away: last ? (Math.abs(level - last) / last) * 100 : null });
        continue;
      }
      const R = Math.abs(s.order.entry - s.order.stopLoss);
      actNow.push({
        ...base, state: "filled", entryKind: "limit", entry: s.order.entry, stop: s.order.stopLoss, cap: null, breakeven: s.order.breakEven, candles,
        rNow: last != null && R > 0 ? ((s.side === "long" ? 1 : -1) * (last - s.order.entry)) / R : null,
        risk: riskForGrade(s.grade), accounts: accountsForGrade(s.grade, accounts), reward: null,
        take: {
          ref: { market: "forex", instrument: s.pair, side: s.side, entry: "forex", rangeLo: s.range.lo, rangeHi: s.range.hi },
          instrument: s.pair, executeSymbol: null, side: s.side, grade: s.grade, entry: s.order.entry, stop: s.order.stopLoss, cap: null,
          entryKind: "limit", samePrices: true, readLocked: null, readAgrees: null, entryDate: s.lastBarDate,
        },
      });
    }

    actNow.sort((a, b) => a.grade.localeCompare(b.grade));
    working.sort((a, b) => (a.away ?? 99) - (b.away ?? 99));

    // Event housekeeping
    const upcoming: string[] = [];
    for (const t of open) {
      const syms = symbolsFor(t.instrument);
      for (const e of events.filter((e: any) => syms.includes(e.symbol) && e.date <= addDays(today, 7)))
        upcoming.push(`${t.instrument}: ${e.type} ${e.symbol} on ${e.date}${e.note ? ` (${e.note})` : ""}`);
    }
    const watchStocks = [...new Set<string>([...open.map((t: any) => t.instrument), ...actNow.map((a) => a.instrument), ...working.map((w) => w.instrument)])]
      .filter((x) => specClass(x) === "stock");
    const missingEarnings = watchStocks.filter((x) => !events.some((e: any) => e.symbol === x && e.type === "earnings"));

    return NextResponse.json({
      today,
      closes: closeTimes(),
      accounts: accounts.map((a) => ({ ...a, ledger: ledger(a, trades, month) })),
      trades: open,
      actions: open.flatMap(actionsFor),
      actNow,
      working,
      scannedAt: { futures: fut?.computedAt ?? null, forex: fx?.computedAt ?? null },
      alerts: unreviewed,
      missingEarnings,
      upcoming,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
