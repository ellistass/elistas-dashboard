// app/api/swing/tonight/route.ts — everything the evening routine needs, in one call.
//
// GET → {
//   closes:   when tonight's closes happen in Lagos (DST-aware)
//   accounts: per account — balance, open risk, slots, monthly stop remaining, house pot
//   actions:  one line per required action on open trades
//   decided:  setups decided at this close (forex breaks pending) or live now (futures)
//   alerts:   unreviewed rule breaks
//   prompts:  event dates to add or check
// }
// Reads the STORED scans (never rescans here) so the page opens instantly.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays, fmtPx, ledger, monthOf, specClass, todayUtc } from "@/lib/swing/core";
import { actionsFor, loadAccounts } from "@/lib/swing/trades";
import { symbolsFor } from "@/lib/swing/events";

const nyHour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });

/** Lagos (UTC+1, no DST) time of the 16:00 NY stock close and 17:00 NY forex close. */
function closeTimes(now = new Date()) {
  const utcH = now.getUTCHours();
  const ny = +nyHour.format(now);
  const off = (utcH - ny + 24) % 24;            // 4 in NY summer, 5 in winter
  const lagos = (h: number) => `${String((h + off + 1) % 24).padStart(2, "0")}:00`;
  return { stocks: lagos(16), forex: lagos(17) };
}

export async function GET() {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const today = todayUtc();
    const month = monthOf(today);
    const [accounts, trades, scans, unreviewed, events] = await Promise.all([
      loadAccounts(),
      (db as any).swingTrade.findMany({ where: { OR: [{ status: "open" }, { status: "closed", exitDate: { gte: `${month}-01` } }] } }),
      (db as any).setupScanCache.findMany().catch(() => []),
      (db as any).disciplineEvent.findMany({ where: { kind: "break", reviewedAt: null }, orderBy: { date: "desc" } }).catch(() => []),
      (db as any).tradingEvent.findMany({ where: { date: { gte: today, lte: addDays(today, 120) } }, orderBy: { date: "asc" } }).catch(() => []),
    ]);
    const open = trades.filter((t: any) => t.status === "open");

    // Accounts
    const acc = accounts.map((a) => ({ ...a, ledger: ledger(a, trades, month) }));

    // Actions: urgent first
    const actions = open.flatMap(actionsFor).sort((a: any, b: any) => Number(b.urgent) - Number(a.urgent));

    // Setups decided at this close / live now, from the stored scans
    const inTrade = new Set(open.map((t: any) => t.instrument));
    const fut = scans.find((s: any) => s.key === "futures")?.payload as any;
    const fx = scans.find((s: any) => s.key === "forex")?.payload as any;
    const decided: { market: string; instrument: string; grade: string; side: string; text: string; inTrade: boolean }[] = [];
    for (const s of fx?.setups ?? []) {
      const buy = s.side === "long" ? "BUY" : "SELL";
      const text =
        s.state === "watch" ? `needs a daily close ${s.side === "long" ? "above" : "below"} ${fmtPx(s.breakLevel)} — then ${buy} LIMIT ${fmtPx(s.order.entry)}`
        : s.state === "armed" ? `${buy} LIMIT ${fmtPx(s.order.entry)} working · ${s.order.goodForBars} bars left · stop ${fmtPx(s.order.stopLoss)}`
        : `filled at ${fmtPx(s.order.entry)} on the last bar — stop ${fmtPx(s.order.stopLoss)}`;
      decided.push({ market: "forex", instrument: s.pair, grade: s.grade, side: s.side, text, inTrade: inTrade.has(s.pair) });
    }
    for (const s of fut?.setups ?? []) {
      const long = s.inverted ? s.side !== "long" : s.side === "long";
      const buy = long ? "BUY" : "SELL";
      const sym = s.executeSymbol || s.instrument;
      const text =
        s.state === "trigger" ? `${buy} ${sym} at the next open (${s.entry}) · stop ${fmtPx(s.stop)}`
        : s.state === "armed" ? `${buy} LIMIT ${fmtPx(s.entryPrice)} working · ${s.barsLeft ?? "?"} bars left`
        : `filled at ${fmtPx(s.entryPrice)} on the last bar — stop ${fmtPx(s.stop)}, cap ${fmtPx(s.target)}`;
      decided.push({ market: "futures", instrument: s.instrument, grade: s.grade, side: long ? "long" : "short", text: text + (s.inverted ? " (future's prices)" : ""), inTrade: inTrade.has(s.instrument) });
    }
    const stateOrder = (t: string) => (t.startsWith("needs") ? 0 : t.includes("next open") ? 1 : t.startsWith("filled") ? 2 : 3);
    decided.sort((a, b) => a.grade.localeCompare(b.grade) || stateOrder(a.text) - stateOrder(b.text));

    // Prompts: events for open trades this week; stocks with no upcoming earnings date.
    const prompts: string[] = [];
    for (const t of open) {
      const syms = symbolsFor(t.instrument);
      const soon = events.filter((e: any) => syms.includes(e.symbol) && e.date <= addDays(today, 7));
      for (const e of soon) prompts.push(`${t.instrument}: ${e.type} ${e.symbol} on ${e.date}${e.note ? ` (${e.note})` : ""}`);
    }
    const watchStocks = new Set<string>([
      ...open.map((t: any) => t.instrument),
      ...decided.map((d) => d.instrument),
    ].filter((s) => specClass(s) === "stock"));
    for (const s of watchStocks) {
      if (!events.some((e: any) => e.symbol === s && e.type === "earnings")) prompts.push(`${s}: no upcoming earnings date — add it on Discipline → Event dates`);
    }

    return NextResponse.json({
      today,
      closes: closeTimes(),
      accounts: acc,
      actions,
      decided,
      scannedAt: { futures: scans.find((s: any) => s.key === "futures")?.computedAt ?? null, forex: scans.find((s: any) => s.key === "forex")?.computedAt ?? null },
      alerts: unreviewed,
      prompts,
      openCount: open.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
