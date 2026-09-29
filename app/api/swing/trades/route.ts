// app/api/swing/trades/route.ts — the swing trades you actually took.
//
// GET  ?status=open|closed|all (default all, closed = last 90 days) [&refresh=1]
//      → { trades, actions, accounts }. refresh=1 recomputes open trades from Yahoo first.
// POST → add a trade (your real fills). Size defaults from the instrument spec.
//        The pre-trade gate runs first: a block returns 409 { gate } unless
//        `override: true`, and every failed rule is then logged as a rule break.
// PATCH { id, action: "move-stop", to }                       — stops only move in your favour
//       { id, action: "close", exitDate, exitPrice, exitReason }
//       { id, action: "update", brokerBest?, notes?, feed?, capPrice?, size? }
// DELETE ?id= → remove a trade entered by mistake.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isFxPair, resultOf, riskForGrade, sizeFor, specClass, specFor, todayUtc, type StopMove } from "@/lib/swing/core";
import { defaultFeed } from "@/lib/swing/feeds";
import { actionsFor, loadAccounts, loadSpecs, refreshOpenTrades, refreshTrade } from "@/lib/swing/trades";
import { LOGGED_RULES, runGate } from "@/lib/swing/gate";
import { logBreak } from "@/lib/swing/discipline";
import { matchLogRow } from "@/lib/setups/log";

const T = () => (db as any).swingTrade;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const num = (x: unknown) => (x === "" || x == null ? null : Number.isFinite(Number(x)) ? Number(x) : NaN);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try {
    const q = new URL(req.url).searchParams;
    const status = q.get("status") ?? "all";
    let refresh = null;
    if (q.get("refresh") === "1") refresh = await refreshOpenTrades();
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const where =
      status === "open" ? { status: "open" }
      : status === "closed" ? { status: "closed", exitDate: { gte: since } }
      : { OR: [{ status: "open" }, { status: "closed", exitDate: { gte: since } }] };
    const trades = await T().findMany({ where, orderBy: [{ status: "desc" }, { entryDate: "desc" }] });
    return NextResponse.json({
      trades,
      actions: trades.flatMap(actionsFor),
      accounts: await loadAccounts(),
      refresh,
    });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function POST(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try {
    const b = await req.json();
    const instrument = String(b.instrument ?? "").trim().toUpperCase();
    const side = b.side === "short" ? "short" : b.side === "long" ? "long" : null;
    const entryPrice = num(b.entryPrice), initialStop = num(b.stopPrice), capPrice = num(b.capPrice);
    if (!instrument || !side) return bad("instrument and side are required");
    if (!isDate(b.entryDate)) return bad("entry date must be YYYY-MM-DD");
    if (entryPrice == null || initialStop == null || !Number.isFinite(entryPrice) || !Number.isFinite(initialStop)) return bad("entry and stop are required");
    if (side === "long" ? initialStop >= entryPrice : initialStop <= entryPrice) return bad(`a ${side} stop must be ${side === "long" ? "below" : "above"} the entry`);
    if (capPrice != null && (!Number.isFinite(capPrice) || (side === "long" ? capPrice <= entryPrice : capPrice >= entryPrice))) return bad("the cap must be on the profit side of the entry");

    const accounts = await loadAccounts();
    const account = accounts.find((a) => a.key === b.account);
    if (!account) return bad("pick an account");
    const grade = b.grade === "B" ? "B" : "A";
    const riskUsd = num(b.riskUsd) ?? riskForGrade(grade, account.riskPerTrade);
    if (!Number.isFinite(riskUsd) || riskUsd <= 0) return bad("risk must be a positive dollar amount");
    const spec = specFor(instrument, await loadSpecs());
    const size = num(b.size) ?? sizeFor(riskUsd, entryPrice, initialStop, spec);
    if (!Number.isFinite(size) || size <= 0) return bad("size must be positive");

    const market = isFxPair(instrument) ? "forex" : "futures";
    const cls = specClass(instrument);
    const cardEntry = num(b.cardEntry), cardStop = num(b.cardStop), cardCap = num(b.cardCap);
    const cardEntryKind = b.cardEntryKind === "open" ? "open" : cardEntry != null ? "limit" : null;
    // Card prices and your fill are the same series for stocks and spot FX.
    const samePrices = cls === "stock" || (cls === "forex" && market === "forex");

    // The gate, BEFORE the trade exists (so it isn't counted against itself).
    const gate = await runGate({
      account: account.key, instrument, side, grade, riskUsd, entryPrice, stopPrice: initialStop, size,
      cardEntry, cardStop, cardEntryKind, samePrices, readLocked: b.readLocked ?? null, readAgrees: b.readAgrees ?? null,
    });
    if (gate.blocked && !b.override) return NextResponse.json({ error: "blocked by the pre-trade gate", gate }, { status: 409 });
    const setupLogId = b.setupRef ? await matchLogRow(b.setupRef) : null;

    const t = await T().create({
      data: {
        account: account.key, setupLogId, market, instrument,
        executeSymbol: b.executeSymbol || null, feed: (b.feed && String(b.feed).includes(":")) ? String(b.feed) : defaultFeed(instrument),
        side, grade, entryDate: b.entryDate, entryPrice, initialStop, currentStop: initialStop,
        capPrice, size, riskUsd, stopMoves: [],
        cardEntry, cardStop, cardCap, cardEntryKind, samePrices,
        plannedExitDate: isDate(b.plannedExitDate) ? b.plannedExitDate : gate.plannedExitDate,
        notes: b.notes ? String(b.notes) : null,
      },
    });
    // Taken over a failed rule → it goes in the rule-break log. Blocks always;
    // warnings only for the rules that are about how you placed it.
    for (const c of gate.checks) {
      const logged = c.level === "block" || (c.level === "warn" && ["Levels", "House money", "Read"].includes(c.rule));
      if (logged && LOGGED_RULES.includes(c.rule)) {
        await logBreak({ date: b.entryDate, instrument, rule: c.rule, detail: c.text, tradeId: t.id, setupLogId, auto: true });
      }
    }
    return NextResponse.json({ trade: await refreshTrade(t.id), gate });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function PATCH(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try {
    const b = await req.json();
    const t = await T().findUnique({ where: { id: String(b.id ?? "") } });
    if (!t) return bad("trade not found", 404);
    const R = Math.abs(t.entryPrice - t.initialStop);

    if (b.action === "move-stop") {
      if (t.status !== "open") return bad("trade is closed");
      const to = num(b.to);
      if (to == null || !Number.isFinite(to)) return bad("new stop required");
      const favour = t.side === "long" ? to > t.currentStop : to < t.currentStop;
      if (!favour) return bad("stops only move in your favour — never widen the stop");
      const date = isDate(b.date) ? b.date : t.lastDate ?? todayUtc();
      const byRule = t.suggestedStop != null && Math.abs(to - t.suggestedStop) <= R * 0.02;
      const moves: StopMove[] = [...(t.stopMoves ?? []), { date, from: t.currentStop, to, byRule }];
      await T().update({ where: { id: t.id }, data: { currentStop: to, stopMoves: moves as any, moveDueSince: null } });
      return NextResponse.json({ trade: await refreshTrade(t.id) });
    }

    if (b.action === "close") {
      const exitPrice = num(b.exitPrice);
      if (exitPrice == null || !Number.isFinite(exitPrice)) return bad("exit price required");
      if (!isDate(b.exitDate)) return bad("exit date must be YYYY-MM-DD");
      const res = resultOf(t.side, t.entryPrice, t.initialStop, exitPrice, t.riskUsd);
      const trade = await T().update({
        where: { id: t.id },
        data: { status: "closed", exitDate: b.exitDate, exitPrice, exitReason: String(b.exitReason ?? "manual"), ...res },
      });
      return NextResponse.json({ trade });
    }

    if (b.action === "update") {
      const data: Record<string, unknown> = {};
      if ("brokerBest" in b) data.brokerBest = num(b.brokerBest);
      if ("notes" in b) data.notes = b.notes ? String(b.notes) : null;
      if ("feed" in b && String(b.feed).includes(":")) data.feed = String(b.feed);
      if ("capPrice" in b) data.capPrice = num(b.capPrice);
      if ("size" in b && Number(b.size) > 0) data.size = Number(b.size);
      if (Object.values(data).some((v) => typeof v === "number" && !Number.isFinite(v))) return bad("numbers only");
      await T().update({ where: { id: t.id }, data });
      return NextResponse.json({ trade: await refreshTrade(t.id) });
    }

    if (b.action === "reopen") {
      const trade = await T().update({ where: { id: t.id }, data: { status: "open", exitDate: null, exitPrice: null, exitReason: null, resultR: null, pnlUsd: null } });
      return NextResponse.json({ trade: await refreshTrade(trade.id) });
    }

    return bad("unknown action");
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function DELETE(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  try {
    await T().delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}
