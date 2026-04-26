// app/api/market-data/raw/route.ts
// Returns the raw barchart data exactly as it will be sent to Claude.
// Use this to verify what pairs are being scraped and that directional data is intact.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { fetchAllMarketData } from "@/lib/fetchers";

export async function GET() {
  try {
    const { barchart, perfMap, stddevMap, calEvents, centralBankRates, fetchedAt, errors } =
      await fetchAllMarketData();

    if (!barchart) {
      return NextResponse.json(
        { error: "No Barchart snapshot in DB — run barchart-sync first", errors },
        { status: 404 },
      );
    }

    const forexPerfPairs = [
      ...barchart.forex.performance.today.bullish,
      ...barchart.forex.performance.today.bearish,
    ].sort((a, b) => b.percentChange - a.percentChange);

    const forexSurprisePairs = [
      ...barchart.forex.surprises.bullish,
      ...barchart.forex.surprises.bearish,
    ].sort(
      (a, b) =>
        (b.standardDeviation ?? b.percentChange) - (a.standardDeviation ?? a.percentChange),
    );

    const futuresPairs = [
      ...barchart.futures.performance.today.bullish,
      ...barchart.futures.performance.today.bearish,
    ].sort((a, b) => b.percentChange - a.percentChange);

    return NextResponse.json({
      fetchedAt,
      dataAge: barchart.fetchedAt,
      errors,
      summary: {
        forexPerfPairCount:     forexPerfPairs.length,
        forexSurprisePairCount: forexSurprisePairs.length,
        futuresContractCount:   futuresPairs.length,
        calendarEventCount:     calEvents.length,
        centralBankRateCount:   centralBankRates.length,
      },
      // Legacy aggregated maps (no longer sent to Claude — kept for reference)
      legacyPerfMap:   perfMap,
      legacyStddevMap: stddevMap,
      // Raw pairs — this is what Claude now receives
      forexPerformance: forexPerfPairs.map((r) => ({
        symbol:        r.symbol,
        percentChange: r.percentChange,
      })),
      forexSurprises: forexSurprisePairs.map((r) => ({
        symbol:            r.symbol,
        stddev:            r.standardDeviation ?? r.percentChange,
        percentChange:     r.percentChange,
      })),
      futures: futuresPairs.map((r) => ({
        symbol:        r.name || r.symbol,
        percentChange: r.percentChange,
      })),
      economicCalendar: calEvents,
      centralBankRates,
    });
  } catch (err: any) {
    console.error("Raw market data error:", err);
    return NextResponse.json({ error: err.message || "Failed" }, { status: 500 });
  }
}
