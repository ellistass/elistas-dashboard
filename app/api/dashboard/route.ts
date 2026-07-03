// app/api/dashboard/route.ts
// Single endpoint returning everything the live dashboard renders.
//
// Sections:
//   • scores              today's RFDM scoring (top3/bottom3/pairs9/ideas)
//   • openTrades          with alignment status + news-collision events attached
//   • sectors             S&P sector map for risk-on/off context
//   • centralBankRates    latest snapshot
//   • freshness           per-source data age + status (fresh/stale/missing)
//   • dailyR              today's realized R vs the -2R cutoff
//   • nextEvent           next high-impact calendar event with absolute date
//   • macros              DXY + VIX context tiles
//   • todaysIdeas         Claude's ideas[] from today's alert (for the trade plan board)
//   • recentAlerts        last 5 Telegram alerts sent (audit trail)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildFreshness,
  buildDailyR,
  buildRecentAlerts,
  collisionsForTrade,
  loadCalendar,
  loadTodaysIdeas,
  loadTodaysIdeaActions,
  nextHighImpactEvent,
  pickDxyVix,
} from "@/lib/dashboard-context";
import { normalizeRanking } from "@/lib/normalize-ranking";

export async function GET() {
  try {
    // ── Today's saved scores from the latest DailyAlert ─────────────────────
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let scores: any = null;
    const saved = await db.dailyAlert.findUnique({ where: { date: today } });
    if (saved) {
      // Defensive normalize on read — handles legacy rows where top3/bottom3
      // were saved as plain currency-code strings instead of score objects.
      // Idempotent for new rows that already have the structured shape.
      const fa: any = (saved as any).fullAnalysis ?? {};
      const sourceScores = fa.scores ?? fa.allScores ?? [];
      scores = {
        top3: normalizeRanking(saved.top3, sourceScores),
        bottom3: normalizeRanking(saved.bottom3, sourceScores),
        pairs9: saved.pairs9,
        priority1: saved.priority1,
        ideas: (saved as any).ideas ?? null,
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

    // ── Run independent reads in parallel ──────────────────────────────────
    const [openTradesRaw, sectorsSnap, latestRates, calendar, freshness, dailyR, recentAlerts, todaysIdeas, ideaActions] = await Promise.all([
      db.trade.findMany({ where: { outcome: "Open" }, orderBy: { date: "desc" } }),
      db.barchartSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { data: true, fetchedAt: true } }),
      db.ratesSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { rates: true, fetchedAt: true } }),
      loadCalendar(),
      buildFreshness(),
      buildDailyR(),
      buildRecentAlerts(),
      loadTodaysIdeas(),
      loadTodaysIdeaActions(),
    ]);

    // ── Open trades enriched with alignment + news collisions ──────────────
    const top3Curs = new Set((scores?.top3 ?? []).map((c: any) => c.cur || c.currency));
    const bottom3Curs = new Set((scores?.bottom3 ?? []).map((c: any) => c.cur || c.currency));

    const openTrades = openTradesRaw.map((trade) => {
      // alignment
      let alignmentStatus: "Green" | "Amber" | "Red" | "Unknown" = "Unknown";
      let alignmentReason = scores ? "Run analysis first" : "No scores yet — run analysis first";
      if (scores) {
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

      const newsCollisions = collisionsForTrade(
        { pair: trade.pair, strongCcy: trade.strongCcy, weakCcy: trade.weakCcy },
        calendar,
        120,
      );

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
        riskPercent: trade.riskPercent,
        riskAmount: (trade as any).riskAmount ?? null,
        initialSlPrice: (trade as any).initialSlPrice ?? null,
        strongCcy: trade.strongCcy,
        weakCcy: trade.weakCcy,
        divScore: trade.divScore,
        date: trade.date,
        source: (trade as any).source ?? "manual",
        accountId: trade.accountId,
        lotSize: (trade as any).lotSize ?? null,
        profitCcy: (trade as any).profitCcy ?? null,
        alignmentStatus,
        alignmentReason,
        newsCollisions,
      };
    });

    // ── Sectors, rates, macros from the snapshots ──────────────────────────
    const sectors = ((sectorsSnap?.data as any)?.sectors as any[]) ?? [];
    const centralBankRates = (latestRates?.rates as any) ?? [];
    const macros = pickDxyVix(sectorsSnap?.data);
    const nextEvent = nextHighImpactEvent(calendar);

    return NextResponse.json({
      scores,
      openTrades,
      sectors,
      centralBankRates,
      macros,
      freshness,
      dailyR,
      nextEvent,
      todaysIdeas,
      ideaActions,
      recentAlerts,
      barchartFetchedAt: sectorsSnap?.fetchedAt ?? null,
      ratesFetchedAt: latestRates?.fetchedAt ?? null,
      fetchedAt: new Date().toISOString(),
      fetchErrors: [],
      hasLiveData: !!saved,
      scoredAt: saved?.createdAt || null,
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    return NextResponse.json(
      { error: "Dashboard fetch failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
