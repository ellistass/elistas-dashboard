// app/api/cron/route.ts
// Vercel Cron jobs:
//   - Session alerts: 7:30am WAT (06:30 UTC) + 2:30pm WAT (13:30 UTC)
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scoreWithClaude, formatTelegramAlertAI } from "@/lib/ai-scoring";
import { fetchAllMarketData } from "@/lib/fetchers";
import { sendTelegramMessage } from "@/lib/telegram";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobType = searchParams.get("job") || "session";

  if (jobType === "alignment") {
    return runAlignmentCheck();
  }
  return runSessionAlert();
}

async function runSessionAlert() {
  const hour = new Date().getUTCHours();
  const session = hour < 10 ? "London" : "New York";

  try {
    const { perfMap, calEvents, errors } = await fetchAllMarketData();

    if (Object.keys(perfMap).length === 0 && calEvents.length === 0) {
      await sendTelegramMessage(
        `⚠️ *Elistas — ${session} Alert*\n\n` +
          `Could not fetch market data automatically.\n` +
          `Errors: ${errors.join(", ")}\n\n` +
          `Open the dashboard to manually enter data:\n${process.env.NEXT_PUBLIC_APP_URL}`,
      );
      return NextResponse.json({
        ok: true,
        message: "Fetch failed — reminder sent",
        errors,
      });
    }

    // Score with Claude AI
    const result = await scoreWithClaude({
      mode: "auto",
      perfMap,
      calendarEvents: calEvents,
    });

    // Save to DB
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await db.dailyAlert.upsert({
      where: { date: today },
      create: {
        date: today,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
        sentAt: new Date(),
      },
      update: {
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
        sentAt: new Date(),
      },
    });

    // Save hourly snapshot
    await saveHourlySnapshot(result);

    // Send Telegram
    const message = formatTelegramAlertAI(result, session);
    const sent = await sendTelegramMessage(message);

    // Check alignment of open trades
    await checkOpenTradeAlignment(result);

    return NextResponse.json({
      ok: true,
      sent,
      session,
      priority: result.priority1?.pair,
      scoredBy: "claude-ai",
      fetchErrors: errors,
    });
  } catch (err) {
    console.error("Session cron error:", err);
    await sendTelegramMessage(
      `❌ *Elistas Cron Error*\n${session} scoring failed: ${err}`,
    );
    return NextResponse.json({ error: "Session cron failed" }, { status: 500 });
  }
}

async function runAlignmentCheck() {
  try {
    const { perfMap, calEvents, errors } = await fetchAllMarketData();
    if (Object.keys(perfMap).length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Skipped — no market data",
        errors,
      });
    }

    const result = await scoreWithClaude({
      mode: "auto",
      perfMap,
      calendarEvents: calEvents,
    });
    await saveHourlySnapshot(result);
    await checkOpenTradeAlignment(result);

    return NextResponse.json({
      ok: true,
      scoredBy: "claude-ai",
      fetchErrors: errors,
    });
  } catch (err) {
    console.error("Alignment cron error:", err);
    return NextResponse.json(
      { error: "Alignment cron failed" },
      { status: 500 },
    );
  }
}

async function checkOpenTradeAlignment(result: any) {
  const openTrades = await db.trade.findMany({ where: { outcome: "Open" } });
  if (openTrades.length === 0) return;

  const top3Curs = new Set(result.top3.map((c: any) => c.cur));
  const bottom3Curs = new Set(result.bottom3.map((c: any) => c.cur));
  const alerts: string[] = [];

  for (const trade of openTrades) {
    const strongStillTop = top3Curs.has(trade.strongCcy);
    const weakStillBottom = bottom3Curs.has(trade.weakCcy);
    const status =
      strongStillTop && weakStillBottom
        ? "Green"
        : !strongStillTop && !weakStillBottom
          ? "Red"
          : "Amber";
    const reason =
      status === "Green"
        ? `${trade.strongCcy} still top 3 · ${trade.weakCcy} still bottom 3`
        : status === "Red"
          ? `${trade.strongCcy} dropped out of top 3 AND ${trade.weakCcy} left bottom 3`
          : !strongStillTop
            ? `${trade.strongCcy} no longer in top 3`
            : `${trade.weakCcy} no longer in bottom 3`;

    await db.tradeAlignment.create({
      data: {
        tradeId: trade.id,
        status,
        strongStillTop3: strongStillTop,
        weakStillBottom3: weakStillBottom,
        reason,
      },
    });

    if (status !== "Green") {
      const emoji = status === "Red" ? "🔴" : "🟡";
      alerts.push(
        `${emoji} *${trade.pair} ${trade.direction}*\n${reason}\nEntry: ${trade.entryPrice} · SL: ${trade.slPrice}`,
      );
    }
  }

  if (alerts.length > 0) {
    const time = new Date().toLocaleTimeString("en-GB", {
      timeZone: "Africa/Lagos",
      hour: "2-digit",
      minute: "2-digit",
    });
    await sendTelegramMessage(
      `⚡ *Elistas — Trade Alignment Alert*\n${time} WAT\n\n${alerts.join("\n\n")}\n\nTop 3: ${result.top3.map((c: any) => c.cur).join(" · ")}\nBottom 3: ${result.bottom3.map((c: any) => c.cur).join(" · ")}`,
    );
  }
}

async function saveHourlySnapshot(result: any) {
  const bucket = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const top3 = result.top3.map((c: any) => c.cur);
  const bottom3 = result.bottom3.map((c: any) => c.cur);

  const upserts = result.allScores.map((s: any) =>
    db.hourlyScore.upsert({
      where: { bucket_currency: { bucket, currency: s.cur } },
      create: {
        bucket,
        currency: s.cur,
        score: s.score,
        pricePerf: s.pricePerf || 0,
        top3,
        bottom3,
      },
      update: { score: s.score, pricePerf: s.pricePerf || 0, top3, bottom3 },
    }),
  );
  await Promise.all(upserts);
}
