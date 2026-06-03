// app/api/accounts/[id]/history/route.ts
//
// Per-account trade history feed. Returns the account's closed trades in
// chronological order (open → recent), each annotated with a running balance
// so the dashboard can plot an equity curve and reconcile "starting balance +
// sum(P&L) = current balance".
//
// We treat profitCcy (broker-stamped P&L in account currency) as the source
// of truth for the cash ledger. resultR is included for trade-level R stats
// but the running balance always uses profitCcy.
//
// Reconciliation note: if the broker has deposits/withdrawals/credits between
// trades, sum(profitCcy) will NOT equal currentBalance − startingBalance.
// We surface that delta in the response so the UI can show it as "external
// adjustments" rather than silently mis-render.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const account = await db.account.findUnique({ where: { id: params.id } });
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // All trades for this account, chronological. Include open trades so the
    // UI can show them separately at the head of the table — they don't
    // contribute to running balance until they close.
    const trades = await db.trade.findMany({
      where: { accountId: account.id },
      orderBy: [{ closeTimeUtc: "asc" }, { date: "asc" }],
      select: {
        id: true, ticket: true, source: true,
        pair: true, direction: true, lotSize: true,
        entryPrice: true, slPrice: true, initialSlPrice: true, tpPrice: true, closePrice: true,
        openTimeUtc: true, closeTimeUtc: true, date: true,
        outcome: true, resultR: true, resultPips: true,
        profitCcy: true, commission: true, swap: true,
        riskPercent: true, grade: true, session: true,
        strongCcy: true, weakCcy: true, divScore: true,
        model: true, reason: true, ruleViolations: true,
        notes: true, preTradeNotes: true, postTradeNotes: true,
        screenshotUrl: true, closeScreenshotUrl: true,
        tags: true,
      },
    });

    const closed = trades.filter((t) => t.outcome && t.outcome !== "Open");
    const open   = trades.filter((t) => t.outcome === "Open");

    // Running balance walk — starts at startingBalance, accumulates each
    // closed trade's profitCcy. Falls back to 0 if profitCcy is null (manual
    // trades that pre-date MT4 auto-logging).
    let running = account.startingBalance;
    const closedWithBalance = closed.map((t) => {
      const pnl = t.profitCcy ?? 0;
      running += pnl;
      return { ...t, balanceAfter: running };
    });

    // Stats
    const wins   = closed.filter((t) => t.outcome === "Win").length;
    const losses = closed.filter((t) => t.outcome === "Loss").length;
    const be     = closed.filter((t) => t.outcome === "BE").length;
    const totalR = closed.reduce((s, t) => s + (t.resultR ?? 0), 0);
    const totalPnL = closed.reduce((s, t) => s + (t.profitCcy ?? 0), 0);
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    const avgR = closed.length > 0 ? totalR / closed.length : 0;

    // Reconciliation: starting + sum(profitCcy) should equal currentBalance
    // (modulo open P&L and any external adjustments). The delta exposes any
    // mismatch so the UI can flag missing trades or unrecorded
    // deposits/withdrawals.
    const expectedBalanceFromTrades = account.startingBalance + totalPnL;
    const reconciliation = {
      startingBalance: account.startingBalance,
      currentBalance: account.currentBalance,
      sumClosedPnL: totalPnL,
      expectedFromTrades: expectedBalanceFromTrades,
      externalAdjustments: account.currentBalance - expectedBalanceFromTrades,
      // External adjustments = deposits, withdrawals, broker credits, or
      // trades the EA hasn't synced yet. Worth surfacing not hiding.
    };

    return NextResponse.json({
      account: {
        id: account.id, name: account.name, broker: account.broker,
        currency: account.currency, type: account.type, market: account.market,
        status: account.status,
        startingBalance: account.startingBalance,
        currentBalance: account.currentBalance,
        eaSyncMode: (account as any).eaSyncMode ?? 'full',
      },
      stats: {
        totalTrades: trades.length,
        closedTrades: closed.length,
        openTrades: open.length,
        wins, losses, be,
        winRate, totalR, avgR, totalPnL,
      },
      reconciliation,
      openTrades: open,
      closedTrades: closedWithBalance,
    });
  } catch (err: any) {
    console.error("Account history error:", err);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
