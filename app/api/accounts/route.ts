// app/api/accounts/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// ── GET — list all accounts with computed P&L ─────────────────────────────────
export async function GET() {
  try {
    // Compute "today" boundary once so per-account today stats are consistent
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const accounts = await db.account.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        trades: {
          select: {
            outcome: true, resultR: true, riskPercent: true,
            profitCcy: true, date: true, direction: true, pair: true,
          },
        },
      },
    });

    const enriched = accounts.map((acc) => {
      const closed = acc.trades.filter((t) => t.outcome && t.outcome !== "Open");
      const open   = acc.trades.filter((t) => t.outcome === "Open");
      const totalR = closed.reduce((s, t) => s + (t.resultR ?? 0), 0);
      const wins   = closed.filter((t) => t.outcome === "Win").length;
      const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

      // Today's stats — closed today
      const closedToday = closed.filter((t) => new Date(t.date as any) >= todayStart);
      const todayR = closedToday.reduce((s, t) => s + (t.resultR ?? 0), 0);
      const todayPnLDollars = closedToday.reduce((s, t) => s + (t.profitCcy ?? 0), 0);

      // Computed P&L from trades (using avg risk% × starting balance × R)
      const avgRiskPct = acc.trades.length > 0
        ? acc.trades.reduce((s, t) => s + t.riskPercent, 0) / acc.trades.length
        : 1;
      const riskDollars = (avgRiskPct / 100) * acc.startingBalance;
      const computedPnL = totalR * riskDollars;

      // Drawdown %: how much of max drawdown has been used
      const drawdownUsedPct = acc.currentDrawdownPct;
      const drawdownRemaining = acc.maxDrawdownPct - drawdownUsedPct;
      const drawdownDanger = drawdownRemaining <= acc.maxDrawdownPct * 0.3; // < 30% left

      // Daily DD: how much of the daily-loss limit is used today (in $)
      const dailyDdLimitDollars = (acc.dailyDrawdownLimitPct / 100) * acc.startingBalance;
      const dailyDdUsedDollars = todayPnLDollars < 0 ? Math.abs(todayPnLDollars) : 0;
      const dailyDdPctOfLimit = dailyDdLimitDollars > 0
        ? Math.min(1, dailyDdUsedDollars / dailyDdLimitDollars)
        : 0;

      // Profit target progress (only meaningful for Phase1/Phase2 challenges)
      const profitTargetDollars = acc.profitTarget != null
        ? (acc.profitTarget / 100) * acc.startingBalance
        : null;
      const profitFromStart = (acc.currentEquity ?? acc.currentBalance) - acc.startingBalance;
      const profitTargetPct = profitTargetDollars && profitTargetDollars > 0
        ? Math.max(0, Math.min(1, profitFromStart / profitTargetDollars))
        : null;

      return {
        ...acc,
        trades: undefined, // strip raw trades from response
        stats: {
          totalTrades: acc.trades.length,
          openTrades: open.length,
          closedTrades: closed.length,
          wins,
          winRate: Math.round(winRate * 10) / 10,
          totalR: Math.round(totalR * 100) / 100,
          computedPnL: Math.round(computedPnL * 100) / 100,
          pnl: Math.round((acc.currentBalance - acc.startingBalance) * 100) / 100,
          drawdownRemaining: Math.round(drawdownRemaining * 100) / 100,
          drawdownDanger,
          // Today's slice — drives the per-account tile
          todayR: Math.round(todayR * 100) / 100,
          todayPnLDollars: Math.round(todayPnLDollars * 100) / 100,
          closedToday: closedToday.length,
          // Daily DD progress (red zones if approaching the firm's limit)
          dailyDdLimitDollars: Math.round(dailyDdLimitDollars * 100) / 100,
          dailyDdUsedDollars: Math.round(dailyDdUsedDollars * 100) / 100,
          dailyDdPctOfLimit,
          // Profit target progress (null = no target set, e.g. live retail accounts)
          profitTargetDollars: profitTargetDollars != null ? Math.round(profitTargetDollars * 100) / 100 : null,
          profitFromStart: Math.round(profitFromStart * 100) / 100,
          profitTargetPct,
          // Direction of open positions (first one — handy for the inline summary)
          firstOpenPair: open[0]?.pair ?? null,
          firstOpenDirection: open[0]?.direction ?? null,
        },
      };
    });

    // Aggregate stats across all active accounts
    const active = enriched.filter((a) => a.isActive);
    const aggregate = {
      totalAccounts: accounts.length,
      activeAccounts: active.length,
      byStatus: {
        Phase1:   accounts.filter((a) => a.status === "Phase1").length,
        Phase2:   accounts.filter((a) => a.status === "Phase2").length,
        Funded:   accounts.filter((a) => a.status === "Funded").length,
        Live:     accounts.filter((a) => a.status === "Live").length,
        Breached: accounts.filter((a) => a.status === "Breached").length,
      },
      totalEquity:  active.reduce((s, a) => s + a.currentBalance, 0),
      totalPnL:     active.reduce((s, a) => s + (a.stats.pnl ?? 0), 0),
      dangerAccounts: enriched.filter((a) => a.stats.drawdownDanger && a.isActive).length,
    };

    return NextResponse.json({ accounts: enriched, aggregate });
  } catch (err: any) {
    console.error("Accounts GET error:", err);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }
}

// ── POST — create account ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const account = await db.account.create({
      data: {
        name:                   body.name,
        broker:                 body.broker,
        type:                   body.type,
        market:                 body.market    ?? "forex",
        status:                 body.status,
        currency:               body.currency  ?? "USD",
        startingBalance:        parseFloat(body.startingBalance),
        currentBalance:         parseFloat(body.currentBalance ?? body.startingBalance),
        profitTarget:           body.profitTarget    ? parseFloat(body.profitTarget)    : null,
        maxDrawdownPct:         parseFloat(body.maxDrawdownPct),
        dailyDrawdownLimitPct:  parseFloat(body.dailyDrawdownLimitPct),
        currentDrawdownPct:     parseFloat(body.currentDrawdownPct    ?? 0),
        currentDailyDrawdownPct:parseFloat(body.currentDailyDrawdownPct ?? 0),
        payoutStatus:           body.payoutStatus ?? "None",
        notes:                  body.notes || null,
        isActive:               body.isActive  ?? true,
      },
    });
    return NextResponse.json(account, { status: 201 });
  } catch (err: any) {
    console.error("Account create error:", err);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}

// ── PATCH — update account ────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...raw } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const data: Record<string, any> = { ...raw };
    // Coerce numeric fields if present
    for (const f of ["startingBalance","currentBalance","profitTarget","maxDrawdownPct","dailyDrawdownLimitPct","currentDrawdownPct","currentDailyDrawdownPct"]) {
      if (data[f] !== undefined && data[f] !== null) data[f] = parseFloat(data[f]);
    }

    const account = await db.account.update({ where: { id }, data });
    return NextResponse.json(account);
  } catch (err: any) {
    console.error("Account update error:", err);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

// ── DELETE — soft-delete (archive) ───────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // Soft delete: set isActive = false and status = Archived
    const account = await db.account.update({
      where: { id },
      data: { isActive: false, status: "Archived" },
    });
    return NextResponse.json(account);
  } catch (err: any) {
    console.error("Account delete error:", err);
    return NextResponse.json({ error: "Failed to archive account" }, { status: 500 });
  }
}
