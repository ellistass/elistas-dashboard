// app/api/dashboard/route.ts
// Returns everything the live dashboard needs in one request
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    // Get today's saved scores from DB (set by /api/alerts)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let scores = null;
    const saved = await db.dailyAlert.findUnique({ where: { date: today } });
    if (saved) {
      scores = {
        top3: saved.top3 as any,
        bottom3: saved.bottom3 as any,
        pairs9: saved.pairs9 as any,
        priority1: saved.priority1 as any,
        ideas: (saved as any).ideas as any ?? null,
        allScores:             (saved as any).fullAnalysis?.allScores             ?? [],
        reasoning:             (saved as any).fullAnalysis?.reasoning             ?? null,
        neutralCurrencies:     (saved as any).fullAnalysis?.neutralCurrencies     ?? [],
        excludedCurrencies:    (saved as any).fullAnalysis?.excludedCurrencies    ?? [],
        excludedReasons:       (saved as any).fullAnalysis?.excludedReasons       ?? [],
        marketCondition:       (saved as any).fullAnalysis?.marketCondition       ?? null,
        sessionRecommendation: (saved as any).fullAnalysis?.sessionRecommendation ?? null,
        divergenceWarnings:    (saved as any).fullAnalysis?.divergenceWarnings    ?? [],
        generatedAt: saved.createdAt,
        scoredBy: "claude-ai",
        scoringModel: (saved as any).scoringModel ?? null,
        dataAge: (saved as any).dataAge ?? null,
      };
    }

    // Open trades with alignment
    const openTrades = await db.trade.findMany({
      where: { outcome: "Open" },
      orderBy: { date: "desc" },
    });

    // Check alignment for each open trade against latest scores
    const tradesWithAlignment = openTrades.map((trade) => {
      let alignmentStatus: "Green" | "Amber" | "Red" | "Unknown" = "Unknown";
      let alignmentReason = "No scores yet — run analysis first";

      if (scores) {
        const top3Curs = new Set(
          (scores.top3 as any[]).map((c: any) => c.cur || c.currency),
        );
        const bottom3Curs = new Set(
          (scores.bottom3 as any[]).map((c: any) => c.cur || c.currency),
        );

        const strongStillTop = top3Curs.has(trade.strongCcy);
        const weakStillBottom = bottom3Curs.has(trade.weakCcy);

        if (strongStillTop && weakStillBottom) {
          alignmentStatus = "Green";
          alignmentReason = `${trade.strongCcy} still top 3 · ${trade.weakCcy} still bottom 3`;
        } else if (!strongStillTop && !weakStillBottom) {
          alignmentStatus = "Red";
          alignmentReason = `⚠️ ${trade.strongCcy} dropped out of top 3 AND ${trade.weakCcy} left bottom 3`;
        } else {
          alignmentStatus = "Amber";
          alignmentReason = !strongStillTop
            ? `${trade.strongCcy} no longer in top 3 — monitor closely`
            : `${trade.weakCcy} no longer in bottom 3 — monitor closely`;
        }
      }

      return {
        id: trade.id,
        pair: trade.pair,
        direction: trade.direction,
        model: trade.model,
        grade: trade.grade,
        session: trade.session,
        entryPrice: trade.entryPrice,
        slPrice: trade.slPrice,
        tpPrice: trade.tpPrice,
        strongCcy: trade.strongCcy,
        weakCcy: trade.weakCcy,
        divScore: trade.divScore,
        date: trade.date,
        alignmentStatus,
        alignmentReason,
      };
    });

    return NextResponse.json({
      scores,
      openTrades: tradesWithAlignment,
      fetchedAt: new Date().toISOString(),
      fetchErrors: [],
      hasLiveData: !!saved,
      scoredAt: saved?.createdAt || null,
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    return NextResponse.json(
      { error: "Dashboard fetch failed" },
      { status: 500 },
    );
  }
}
