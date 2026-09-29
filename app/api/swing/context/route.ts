// app/api/swing/context/route.ts — what every setup card's risk block needs,
// fetched once per page: accounts, open trades, instrument specs, upcoming
// events and the latest central-bank rates.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays, todayUtc } from "@/lib/swing/core";
import { loadAccounts, loadSpecs } from "@/lib/swing/trades";

export async function GET() {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const today = todayUtc();
    const [accounts, specs, open, events, rates] = await Promise.all([
      loadAccounts(),
      loadSpecs(),
      (db as any).swingTrade.findMany({
        where: { status: "open" },
        select: { account: true, instrument: true, side: true, size: true, entryPrice: true, initialStop: true, currentStop: true, riskUsd: true, rNow: true },
      }).catch(() => []),
      (db as any).tradingEvent.findMany({ where: { date: { gte: addDays(today, -7), lte: addDays(today, 90) } }, orderBy: { date: "asc" } }).catch(() => []),
      (db as any).ratesSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { rates: true, fetchedAt: true } }).catch(() => null),
    ]);
    const rateRows = Array.isArray(rates?.rates)
      ? (rates.rates as any[]).map((r) => ({ currency: r.currency, bank: r.bankName, rate: r.currentRate, previous: r.previousRate ?? null }))
      : [];
    return NextResponse.json({ today, accounts, specs, open, events, rates: rateRows, ratesAt: rates?.fetchedAt ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
