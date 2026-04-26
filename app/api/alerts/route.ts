// app/api/alerts/route.ts
// Scoring API — uses Claude AI to score currencies
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // Claude 8192-token responses can take 60-90s

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scoreWithClaude, formatTelegramAlertAI } from "@/lib/ai-scoring";
import { fetchAllMarketData } from "@/lib/fetchers";
import { sendTelegramMessage } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      mode = "auto",
      calendar,
      perf,
      stddev,
      futures,
      sendAlert = false,
    } = body;

    let fetchErrors: string[] = [];

    // Build the input for Claude
    let scoringInput: Parameters<typeof scoreWithClaude>[0];

    if (mode === "auto") {
      const { perfMap, stddevMap, calEvents, centralBankRates, barchart, errors } = await fetchAllMarketData();
      fetchErrors = errors;

      if (Object.keys(perfMap).length === 0 && calEvents.length === 0) {
        if (perf || calendar) {
          scoringInput = { mode: "manual", calendar, perf, stddev, futures };
          fetchErrors.push("Auto-fetch failed — fell back to manual data");
        } else {
          return NextResponse.json(
            {
              error: "Auto-fetch failed and no manual data provided",
              details: errors,
            },
            { status: 503 },
          );
        }
      } else {
        const openTradesRaw = await db.trade.findMany({
        where: { outcome: "Open" },
        select: { pair: true, direction: true, strongCcy: true, weakCcy: true, entryPrice: true, slPrice: true, tpPrice: true, grade: true, session: true, divScore: true, date: true },
      });
      const openTrades = openTradesRaw.map(t => ({ ...t, date: t.date.toISOString().split("T")[0] }));
      scoringInput = { mode: "auto", perfMap, stddevMap, calendarEvents: calEvents, centralBankRates, barchart, openTrades };
      }
    } else {
      scoringInput = { mode: "manual", calendar, perf, stddev, futures };
    }

    // Score with Claude AI
    const result = await scoreWithClaude(scoringInput);

    // Save to DB
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await (db.dailyAlert.upsert as any)({
      where: { date: today },
      create: {
        date: today,
        rawCalendar: mode === "manual" ? calendar : null,
        rawPerf: mode === "manual" ? perf : null,
        rawStddev: mode === "manual" ? stddev : null,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
        ideas: (result as any).ideas ?? null,
        scoringModel: result.scoringModel ?? null,
        fullAnalysis: result.debugData as any,
        sentAt: sendAlert ? new Date() : null,
      },
      update: {
        rawCalendar: mode === "manual" ? calendar : undefined,
        rawPerf: mode === "manual" ? perf : undefined,
        rawStddev: mode === "manual" ? stddev : undefined,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
        ideas: (result as any).ideas ?? undefined,
        scoringModel: result.scoringModel ?? undefined,
        fullAnalysis: result.debugData as any,
        sentAt: sendAlert ? new Date() : undefined,
      },
    });

    // Snapshot persistence is useful for alignment checks, but a transient
    // pooler issue should not block scoring itself.
    try {
      await saveHourlySnapshot(result);
    } catch (error: any) {
      console.error("Hourly snapshot warning:", error);
      fetchErrors.push(
        `Hourly snapshot warning: ${error?.message || "snapshot save failed"}`,
      );
    }

    // Optionally send Telegram
    if (sendAlert && result.priority1) {
      const hour = new Date().getUTCHours();
      const session = hour < 10 ? "London" : "New York";
      const message = formatTelegramAlertAI(result, session);
      await sendTelegramMessage(message);
    }

    return NextResponse.json({ ...result, fetchErrors, scoredBy: "claude-ai", scoringModel: result.scoringModel });
  } catch (err: any) {
    console.error("Alert error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to score" },
      { status: 500 },
    );
  }
}

export async function GET() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const alert = await db.dailyAlert.findUnique({ where: { date: today } });
  return NextResponse.json(alert || null);
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
        pricePerf: s.pricePerf,
        top3,
        bottom3,
      },
      update: { score: s.score, pricePerf: s.pricePerf, top3, bottom3 },
    }),
  );

  await Promise.all(upserts);
}
