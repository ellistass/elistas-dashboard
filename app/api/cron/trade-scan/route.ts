// app/api/cron/trade-scan/route.ts — daily trend-strength screener.
//
// Schedule (vercel.json): 21:15 UTC Mon–Fri = 10:15pm WAT, after NY close.
// Mondays additionally send the weekly focus-list digest to Telegram so the
// week starts with "these are the markets" instead of forcing the usual pairs.
//
// Manual trigger: GET /api/cron/trade-scan?digest=1 with the CRON_SECRET bearer.

export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { runScan, persistScan, type MarketScan } from "@/lib/screener/scan";
import { evaluateOutcomes } from "@/lib/screener/outcomes";
import { sendTelegramMessage } from "@/lib/telegram";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runTradeScanJob(req));
}

export async function runTradeScanJob(req: Request) {
  const { searchParams } = new URL(req.url);
  const isMondayUtc = new Date().getUTCDay() === 1;
  const wantDigest = searchParams.get("digest") === "1" || isMondayUtc;

  const outcome = await runScan();
  const runId = await persistScan(outcome, wantDigest ? "weekly-digest" : "daily");

  // Grade past signals with tonight's candles — fully automatic, no extra fetches.
  const evalSummary = await evaluateOutcomes(outcome.candles).catch((e) => {
    console.error("outcome evaluation failed:", e);
    return null;
  });

  // Alert-worthy: fresh trends grading A/B. Daily runs only ping on A-grade
  // fresh trends (rare, worth interrupting for); Monday digest is the full list.
  const focus = outcome.results.filter((r) => r.grade === "A" || r.grade === "B");

  // Daily interrupts: fresh A-grade trends, big ranges where price has reached
  // an edge (top/bottom 15% of the box — spring/upthrust watch), and ADX
  // climax hooks (ADX was 50+, now turning down — exhaustion confirmed).
  const edgeTouches = outcome.results.filter(
    (r) => r.condition === "big-range" && r.pricePosition != null && (r.pricePosition >= 0.85 || r.pricePosition <= 0.15),
  );
  const climaxHooks = outcome.results.filter((r) => r.phase === "climax" && !r.adxRising);

  if (wantDigest) {
    await sendTelegramMessage(weeklyDigest(outcome.results));
  } else {
    const freshA = focus.filter((r) => r.grade === "A" && r.phase === "fresh" && r.condition === "trend");
    if (freshA.length || edgeTouches.length || climaxHooks.length)
      await sendTelegramMessage(dailyAlert(freshA, edgeTouches, climaxHooks));
  }

  return {
    ok: true,
    runId,
    scanned: outcome.results.length,
    outcomes: evalSummary,
    errors: outcome.errors,
    focus: focus.map((r) => ({
      market: r.market.displayName,
      condition: r.condition,
      direction: r.direction,
      phase: r.phase,
      adx: r.adx,
      er: r.er,
      score: r.score,
      grade: r.grade,
      rfdm: r.rfdmNote,
    })),
    rangeWatch: edgeTouches.map((r) => ({
      market: r.market.displayName,
      box: [r.rangeLow, r.rangeHigh],
      widthAtr: r.rangeWidthAtr,
      pricePosition: r.pricePosition,
    })),
  };
}

// ── Telegram formatting ───────────────────────────────────────────────────────

const dirArrow = (d: string) => (d === "long" ? "▲ LONG" : d === "short" ? "▼ SHORT" : "–");

function line(r: MarketScan): string {
  const mt4 = r.market.tradeable ? "" : " (not on MT4)";
  const rfdm = r.rfdmAgrees === true ? " · RFDM ✓" : r.rfdmAgrees === false ? " · RFDM ✗" : "";
  return `${r.grade} ${r.score} — *${r.market.displayName}* ${dirArrow(r.direction)} · ADX ${r.adx}${r.adxRising ? "↑" : "↓"} · ${r.phase}${rfdm}${mt4}`;
}

// Big ranges with price near an edge — spring/upthrust (Model A) territory.
// The H4 box also often trends on H1 between its boundaries.
function rangeLine(r: MarketScan): string {
  const pos = r.pricePosition ?? 0.5;
  const edge = pos >= 0.8 ? `at range TOP — upthrust watch` : pos <= 0.2 ? `at range BOTTOM — spring watch` : `mid-range (${Math.round(pos * 100)}%)`;
  const mt4 = r.market.tradeable ? "" : " (not on MT4)";
  return `*${r.market.displayName}* — box ${fmtPx(r)} · ${r.rangeWidthAtr} ATRs wide · ${edge}${mt4}`;
}

function fmtPx(r: MarketScan): string {
  const digits = r.lastClose < 10 ? 4 : 2;
  return `${r.rangeLow?.toFixed(digits)}–${r.rangeHigh?.toFixed(digits)}`;
}

function climaxLine(r: MarketScan): string {
  const hook = !r.adxRising ? " · HOOKED DOWN — exhaustion confirmed" : " · still rising, wait for the hook";
  const mt4 = r.market.tradeable ? "" : " (not on MT4)";
  return `*${r.market.displayName}* ${dirArrow(r.direction)} · ADX ${r.adx}${r.adxRising ? "↑" : "↓"}${hook}${mt4}`;
}

function weeklyDigest(results: MarketScan[]): string {
  const fresh = results.filter((r) => r.condition === "trend" && r.phase === "fresh" && r.grade !== "skip").slice(0, 8);
  const established = results.filter((r) => r.condition === "trend" && r.phase === "established" && r.grade !== "skip").slice(0, 5);
  const forming = results
    .filter((r) => r.condition === "transition" && r.score >= 55 && r.adxRising && r.direction !== "none")
    .slice(0, 5);
  const climax = results.filter((r) => r.phase === "climax");
  const bigRanges = results
    .filter((r) => r.condition === "big-range")
    .sort((x, y) => {
      // edges first (distance from mid-range), then wider boxes
      const edge = (r: MarketScan) => Math.abs((r.pricePosition ?? 0.5) - 0.5);
      return edge(y) - edge(x) || (y.rangeWidthAtr ?? 0) - (x.rangeWidthAtr ?? 0);
    })
    .slice(0, 6);

  let msg = `*Weekly Focus List — Trend Screener*\n_H4 sweep of ${results.length} markets_\n\n`;

  msg += `*Fresh trends (ADX 20–30 rising — the prize)*\n`;
  msg += fresh.length ? fresh.map(line).join("\n") : "_none this week — don't force it_";
  msg += `\n\n*Established trends (later in the move)*\n`;
  msg += established.length ? established.map(line).join("\n") : "_none_";
  msg += `\n\n*Big ranges (reversal watch — springs/upthrusts at the edges, H1 can trend inside)*\n`;
  msg += bigRanges.length ? bigRanges.map(rangeLine).join("\n") : "_none_";

  if (forming.length) {
    msg += `\n\n*Forming (crawling, not confirmed — watch for promotion)*\n${forming.map(line).join("\n")}`;
  }
  if (climax.length) {
    msg += `\n\n*Climax — ADX 50+ (never a trend entry; reversal hunt on the hook)*\n${climax.map(climaxLine).join("\n")}`;
  }

  msg += `\n\n*Next step*\n→ Open shortlist charts on MT4\n→ Volume/effort read (David Paul) before any entry\n→ Entries still require full RFDM: model declared, H1 volume, session window`;
  return msg;
}

function dailyAlert(freshA: MarketScan[], edgeTouches: MarketScan[], climaxHooks: MarketScan[]): string {
  let msg = `*Trend Screener — daily*\n`;
  if (freshA.length) {
    msg += `\n*Fresh A-grade trend${freshA.length > 1 ? "s" : ""}*\n${freshA.map(line).join("\n")}\n`;
  }
  if (edgeTouches.length) {
    msg += `\n*Range edge touched — Model A watch*\n${edgeTouches.map(rangeLine).join("\n")}\n`;
  }
  if (climaxHooks.length) {
    msg += `\n*ADX climax hook — exhaustion, reversal hunt*\n${climaxHooks.map(climaxLine).join("\n")}\n`;
  }
  msg += `\n→ Check volume/effort on MT4 before acting`;
  return msg;
}
