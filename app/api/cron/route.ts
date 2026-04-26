// app/api/cron/route.ts
// Vercel Cron jobs:
//   - Session alerts: 7:30am WAT (06:30 UTC) + 2:30pm WAT (13:30 UTC)
export const runtime = "nodejs";
export const maxDuration = 300; // Claude 8192-token responses can take 60-90s

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scoreWithClaude, formatTelegramAlertAI } from "@/lib/ai-scoring";
import { fetchAllMarketData } from "@/lib/fetchers";
import { sendTelegramMessage } from "@/lib/telegram";

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobType = searchParams.get("job") || "session";

  if (jobType === "alignment") return runAlignmentCheck();
  return runSessionAlert();
}

// ── Data freshness gate ───────────────────────────────────────────────────────
// Returns age in minutes, or null if no snapshot exists.

async function getBarchartAgeMinutes(): Promise<number | null> {
  const snap = await db.barchartSnapshot.findFirst({
    orderBy: { fetchedAt: "desc" },
    select: { fetchedAt: true },
  });
  if (!snap) return null;
  return Math.floor((Date.now() - snap.fetchedAt.getTime()) / 60_000);
}

async function getSnapshotAges(): Promise<{
  barchart: number | null;
  economic: number | null;
  rates: number | null;
}> {
  const [bc, ec, rc] = await Promise.all([
    db.barchartSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } }),
    db.economicSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } }),
    db.ratesSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } }),
  ]);
  const age = (s: { fetchedAt: Date } | null) =>
    s ? Math.floor((Date.now() - s.fetchedAt.getTime()) / 60_000) : null;
  return { barchart: age(bc), economic: age(ec), rates: age(rc) };
}

async function logSyncHealth(opts: {
  ages: { barchart: number | null; economic: number | null; rates: number | null };
  status: "Fresh" | "Stale" | "Missing";
  action: "Scored" | "Skipped" | "Warning";
  errors: string[];
}) {
  try {
    await db.syncHealth.create({
      data: {
        barchartAgeMinutes:  opts.ages.barchart,
        economicAgeMinutes:  opts.ages.economic,
        ratesAgeMinutes:     opts.ages.rates,
        status:              opts.status,
        action:              opts.action,
        errors:              opts.errors,
      },
    });
  } catch (e) {
    console.error("SyncHealth log failed:", e);
  }
}

// ── Session alert ─────────────────────────────────────────────────────────────

async function runSessionAlert() {
  const hour = new Date().getUTCHours();
  const session = hour < 12 ? "London" : "New York";
  const ages = await getSnapshotAges();

  // ── Freshness gate: skip if Barchart data is older than 90 minutes ──
  if (ages.barchart === null) {
    const msg = `⚠️ *Elistas — ${session} Alert*\n\nNo Barchart snapshot found in DB.\nCheck GitHub Actions barchart-sync.\n\n${process.env.NEXT_PUBLIC_APP_URL}`;
    await sendTelegramMessage(msg);
    await logSyncHealth({ ages, status: "Missing", action: "Skipped", errors: ["No Barchart snapshot"] });
    return NextResponse.json({ ok: true, message: "No snapshot — warning sent" });
  }

  if (ages.barchart > 90) {
    const msg = `⚠️ *Elistas — ${session} Alert*\n\nBarchart data is *${ages.barchart} minutes old* — scoring skipped.\nCheck GitHub Actions: ${process.env.NEXT_PUBLIC_APP_URL}`;
    await sendTelegramMessage(msg);
    await logSyncHealth({ ages, status: "Stale", action: "Skipped", errors: [`Barchart ${ages.barchart}min old`] });
    return NextResponse.json({ ok: true, message: `Stale data (${ages.barchart}min) — skipped` });
  }

  try {
    const { perfMap, stddevMap, calEvents, centralBankRates, barchart, errors } =
      await fetchAllMarketData();

    if (Object.keys(perfMap).length === 0 && calEvents.length === 0) {
      await sendTelegramMessage(
        `⚠️ *Elistas — ${session} Alert*\n\nCould not read market data from DB.\nErrors: ${errors.join(", ")}\n\nOpen dashboard to enter manually:\n${process.env.NEXT_PUBLIC_APP_URL}`,
      );
      await logSyncHealth({ ages, status: "Stale", action: "Warning", errors });
      return NextResponse.json({ ok: true, message: "DB read failed — reminder sent", errors });
    }

    const openTradesRaw = await db.trade.findMany({
      where: { outcome: "Open" },
      select: { pair: true, direction: true, strongCcy: true, weakCcy: true, entryPrice: true, slPrice: true, tpPrice: true, grade: true, session: true, divScore: true, date: true },
    });
    const openTrades = openTradesRaw.map(t => ({ ...t, date: t.date.toISOString().split("T")[0] }));

    const result = await scoreWithClaude({
      mode: "auto", perfMap, stddevMap, calendarEvents: calEvents, centralBankRates, barchart, openTrades,
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await (db.dailyAlert.upsert as any)({
      where:  { date: today },
      create: { date: today, top3: result.top3 as any, bottom3: result.bottom3 as any, pairs9: result.pairs9 as any, priority1: result.priority1 as any, ideas: (result as any).ideas ?? null, fullAnalysis: result.debugData as any, dataAge: ages.barchart, scoringModel: result.scoringModel ?? null, sentAt: new Date() },
      update: { top3: result.top3 as any, bottom3: result.bottom3 as any, pairs9: result.pairs9 as any, priority1: result.priority1 as any, ideas: (result as any).ideas ?? undefined, fullAnalysis: result.debugData as any, dataAge: ages.barchart, scoringModel: result.scoringModel ?? undefined, sentAt: new Date() },
    });

    try { await saveHourlySnapshot(result); } catch (e) { console.error("Snapshot warning:", e); }

    const message = formatTelegramAlertAI(result, session);
    const sent = await sendTelegramMessage(message);
    await checkOpenTradeAlignment(result);
    await logSyncHealth({ ages, status: "Fresh", action: "Scored", errors });

    return NextResponse.json({ ok: true, sent, session, priority: result.priority1?.pair, scoredBy: "claude-ai", dataAge: ages.barchart, fetchErrors: errors });
  } catch (err) {
    console.error("Session cron error:", err);
    await sendTelegramMessage(`❌ *Elistas Cron Error*\n${session} scoring failed: ${err}`);
    await logSyncHealth({ ages, status: "Fresh", action: "Warning", errors: [String(err)] });
    return NextResponse.json({ error: "Session cron failed" }, { status: 500 });
  }
}

// ── Alignment check ───────────────────────────────────────────────────────────

async function runAlignmentCheck() {
  const ages = await getSnapshotAges();

  // Same freshness gate — skip silently if stale (no Telegram spam)
  if (ages.barchart === null || ages.barchart > 90) {
    await logSyncHealth({ ages, status: ages.barchart === null ? "Missing" : "Stale", action: "Skipped", errors: [] });
    return NextResponse.json({ ok: true, message: "Skipped — stale or missing data" });
  }

  try {
    const { perfMap, stddevMap, calEvents, centralBankRates, barchart, errors } =
      await fetchAllMarketData();
    if (Object.keys(perfMap).length === 0) {
      await logSyncHealth({ ages, status: "Stale", action: "Skipped", errors });
      return NextResponse.json({ ok: true, message: "Skipped — no market data", errors });
    }

    const openTradesRawA = await db.trade.findMany({
      where: { outcome: "Open" },
      select: { pair: true, direction: true, strongCcy: true, weakCcy: true, entryPrice: true, slPrice: true, tpPrice: true, grade: true, session: true, divScore: true, date: true },
    });
    const openTradesForAlignment = openTradesRawA.map(t => ({ ...t, date: t.date.toISOString().split("T")[0] }));

    const result = await scoreWithClaude({ mode: "auto", perfMap, stddevMap, calendarEvents: calEvents, centralBankRates, barchart, openTrades: openTradesForAlignment });
    try { await saveHourlySnapshot(result); } catch (e) { console.error("Snapshot warning:", e); }
    await checkOpenTradeAlignment(result);
    await logSyncHealth({ ages, status: "Fresh", action: "Scored", errors });

    return NextResponse.json({ ok: true, scoredBy: "claude-ai", fetchErrors: errors });
  } catch (err) {
    console.error("Alignment cron error:", err);
    await logSyncHealth({ ages, status: "Fresh", action: "Warning", errors: [String(err)] });
    return NextResponse.json({ error: "Alignment cron failed" }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function checkOpenTradeAlignment(result: any) {
  const openTrades = await db.trade.findMany({ where: { outcome: "Open" } });
  if (openTrades.length === 0) return;

  const top3Curs    = new Set(result.top3.map((c: any) => c.cur));
  const bottom3Curs = new Set(result.bottom3.map((c: any) => c.cur));
  const alerts: string[] = [];

  for (const trade of openTrades) {
    const strongStillTop  = top3Curs.has(trade.strongCcy);
    const weakStillBottom = bottom3Curs.has(trade.weakCcy);
    const status =
      strongStillTop && weakStillBottom   ? "Green" :
      !strongStillTop && !weakStillBottom ? "Red"   : "Amber";
    const reason =
      status === "Green" ? `${trade.strongCcy} still top 3 · ${trade.weakCcy} still bottom 3` :
      status === "Red"   ? `${trade.strongCcy} dropped out of top 3 AND ${trade.weakCcy} left bottom 3` :
      !strongStillTop    ? `${trade.strongCcy} no longer in top 3` :
                           `${trade.weakCcy} no longer in bottom 3`;

    await db.tradeAlignment.create({
      data: { tradeId: trade.id, status, strongStillTop3: strongStillTop, weakStillBottom3: weakStillBottom, reason },
    });

    if (status !== "Green") {
      alerts.push(`${status === "Red" ? "🔴" : "🟡"} *${trade.pair} ${trade.direction}*\n${reason}\nEntry: ${trade.entryPrice} · SL: ${trade.slPrice}`);
    }
  }

  if (alerts.length > 0) {
    const time = new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });
    await sendTelegramMessage(
      `⚡ *Elistas — Trade Alignment Alert*\n${time} WAT\n\n${alerts.join("\n\n")}\n\nTop 3: ${result.top3.map((c: any) => c.cur).join(" · ")}\nBottom 3: ${result.bottom3.map((c: any) => c.cur).join(" · ")}`,
    );
  }
}

async function saveHourlySnapshot(result: any) {
  const bucket = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const top3    = result.top3.map((c: any) => c.cur);
  const bottom3 = result.bottom3.map((c: any) => c.cur);
  const upserts = result.allScores.map((s: any) =>
    db.hourlyScore.upsert({
      where:  { bucket_currency: { bucket, currency: s.cur } },
      create: { bucket, currency: s.cur, score: s.score, pricePerf: s.pricePerf || 0, top3, bottom3 },
      update: { score: s.score, pricePerf: s.pricePerf || 0, top3, bottom3 },
    }),
  );
  await Promise.all(upserts);
}
