// app/api/cron/trade-scan/route.ts — the combined daily scan job.
//
// Schedule: fired from /api/cron/idea-outcomes at 21:15 UTC Mon–Fri (10:15pm
// WAT, after NY close — equity daily bars final at 20:00 UTC, CME futures
// sessions closed by 21:00 UTC, and Yahoo posts the settled bars promptly).
//
// ONE run, THREE independently error-isolated lanes, ONE two-section Telegram
// digest. The lanes answer different questions and must not blur into one
// signal:
//   1. Trend screener (H4 ADX momentum — which markets are strong/weak).
//      Existing logic, unchanged.
//   2. Wyckoff Range Scanner (structural — which markets have a range at a
//      decision point). Persists EVERY range with its locked engine verdict;
//      surfaces FRESH candidates only.
//   3. Wyckoff outcome backfill (§9) — keeps the you-vs-engine benchmark
//      current.
//
// HARD RULE: the Wyckoff section of the digest NEVER contains the engine
// verdict, a direction, or an entry. The persistence path (lib/wyckoff/scan)
// writes the verdict; the digest assembly below reads only trader-facing
// fields. If a lane fails, the others still run and the digest says so —
// a quiet day reads "no fresh candidates", not silence.
//
// Manual trigger: GET /api/cron/trade-scan?digest=1 with the CRON_SECRET bearer.

export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { runScan, persistScan, type MarketScan } from "@/lib/screener/scan";
import { evaluateOutcomes } from "@/lib/screener/outcomes";
import { runWyckoffScan, backfillOutcomes, type Candidate } from "@/lib/wyckoff/scan";
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

  // ── Lane 1: trend screener (existing logic, unchanged) ─────────────────────
  let trend: Record<string, unknown> | null = null;
  let trendError: string | null = null;
  let trendSection = "";
  try {
    const outcome = await runScan();
    const runId = await persistScan(outcome, wantDigest ? "weekly-digest" : "daily");

    // Grade past signals with tonight's candles — fully automatic, no extra fetches.
    const evalSummary = await evaluateOutcomes(outcome.candles).catch((e) => {
      console.error("outcome evaluation failed:", e);
      return null;
    });

    const focus = outcome.results.filter((r) => r.grade === "A" || r.grade === "B");
    const edgeTouches = outcome.results.filter(
      (r) =>
        r.condition === "big-range" &&
        r.pricePosition != null &&
        (r.pricePosition >= 0.85 || r.pricePosition <= 0.15),
    );
    const climaxHooks = outcome.results.filter((r) => r.phase === "climax" && !r.adxRising);
    const freshA = focus.filter(
      (r) => r.grade === "A" && r.phase === "fresh" && r.condition === "trend",
    );

    trendSection = wantDigest
      ? weeklyDigest(outcome.results)
      : dailyTrendSection(freshA, edgeTouches, climaxHooks);

    trend = {
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
  } catch (e) {
    trendError = e instanceof Error ? e.message : String(e);
    console.error("[trade-scan] trend lane failed:", e);
    trendSection = `*Trend screener*\n_scan failed today — see logs_`;
  }

  // ── Lane 2: Wyckoff range scan (persist-all, surface-fresh) ────────────────
  let wyckoff: Record<string, unknown> | null = null;
  let wyckoffError: string | null = null;
  let wyckoffSection = "";
  try {
    const res = await runWyckoffScan();
    wyckoffSection = wyckoffDigest(res.candidates, res.latestBarDate, res.scanned, res.rangesFound);
    // Counts only in the job log — candidates carry no verdict anyway, but the
    // ops payload doesn't need to repeat the digest.
    wyckoff = {
      scanned: res.scanned,
      rangesFound: res.rangesFound,
      persisted: res.persisted,
      freshCount: res.candidates.length,
      latestBarDate: res.latestBarDate,
      errors: res.errors,
    };
  } catch (e) {
    wyckoffError = e instanceof Error ? e.message : String(e);
    console.error("[trade-scan] wyckoff lane failed:", e);
    wyckoffSection = `*Wyckoff ranges*\n_scan failed today — see logs_`;
  }

  // ── Lane 3: Wyckoff outcome backfill (benchmark upkeep) ────────────────────
  let backfill: Record<string, unknown> | null = null;
  let backfillError: string | null = null;
  try {
    backfill = { ...(await backfillOutcomes()) };
  } catch (e) {
    backfillError = e instanceof Error ? e.message : String(e);
    console.error("[trade-scan] wyckoff backfill failed:", e);
  }

  // ── One two-section digest ─────────────────────────────────────────────────
  let telegramSent = false;
  try {
    await sendTelegramMessage(`${trendSection}\n\n${wyckoffSection}`);
    telegramSent = true;
  } catch (e) {
    console.error("[trade-scan] telegram send failed:", e);
  }

  return {
    ok: !trendError && !wyckoffError && !backfillError,
    trend,
    trendError,
    wyckoff,
    wyckoffError,
    backfill,
    backfillError,
    telegramSent,
  };
}

// ── Telegram formatting — trend lane (unchanged content) ──────────────────────

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

// Daily trend section — same interrupt logic as before, but a quiet day now
// says so explicitly (the combined digest sends every day, so silence must be
// distinguishable from a broken job).
function dailyTrendSection(freshA: MarketScan[], edgeTouches: MarketScan[], climaxHooks: MarketScan[]): string {
  let msg = `*Trend Screener — daily*\n`;
  if (!freshA.length && !edgeTouches.length && !climaxHooks.length) {
    return msg + `_no interrupts today — no fresh A-grades, edge touches, or climax hooks_`;
  }
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

// ── Telegram formatting — Wyckoff lane ────────────────────────────────────────
// Trader-facing fields ONLY: instrument, box, bars, context, terminal test,
// stopping action, open/broken. No engine verdict. No direction. No entry.

function wyckoffLine(c: Candidate): string {
  const digits = c.rangeHi < 10 ? 4 : 2;
  const box = `${c.rangeLo.toFixed(digits)}–${c.rangeHi.toFixed(digits)}`;
  const ctx = c.contextPct == null ? "ctx n/a" : `ctx ${c.contextPct > 0 ? "+" : ""}${c.contextPct}%`;
  const test = c.terminalTest === "none" ? "no terminal test" : `test: ${c.terminalTest}`;
  const stop = c.stoppingAction ? " · stopping action" : "";
  const state = c.status === "open" ? "OPEN — still inside" : `broke out ${c.breakoutDate}`;
  return `*${c.instrument}* — box ${box} · ${c.barsInRange} bars · ${ctx} · ${test}${stop} · ${state}`;
}

function wyckoffDigest(
  candidates: Candidate[],
  latestBarDate: string | null,
  scanned: number,
  rangesFound: number,
): string {
  const dataNote = latestBarDate ? ` (data through ${latestBarDate})` : "";
  if (!candidates.length) {
    // A quiet day is the normal state for a ~6-setups-a-month edge — confirm
    // the scan RAN and found nothing, so silence is never ambiguous.
    return (
      `*Wyckoff ranges*${dataNote}\n` +
      `_no fresh candidates today — scan ran clean (${scanned} instruments, ${rangesFound} ranges tracked)_`
    );
  }
  return (
    `*Wyckoff ranges — ${candidates.length} fresh candidate${candidates.length > 1 ? "s" : ""}*${dataNote}\n` +
    candidates.map(wyckoffLine).join("\n") +
    `\n→ read the charts — the tool gives no direction`
  );
}
