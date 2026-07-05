// scripts/scan-preview.ts — run the trend screener locally against live Yahoo
// data and print the results. Nothing is saved, no Telegram is sent.
//
//   npx tsx scripts/scan-preview.ts
//
// Requires .env with DATABASE_URL for the RFDM cross-check; if the DB is
// unreachable the scan still runs, just without RFDM notes.

import { runScan, type MarketScan } from "../lib/screener/scan";

const dirArrow = (d: string) => (d === "long" ? "▲ LONG " : d === "short" ? "▼ SHORT" : "  —    ");

function trendLine(r: MarketScan): string {
  const rfdm = r.rfdmAgrees === true ? " RFDM✓" : r.rfdmAgrees === false ? " RFDM✗" : "";
  const mt4 = r.market.tradeable ? "" : " (not on MT4)";
  return [
    r.grade.padEnd(4),
    String(r.score).padStart(5),
    r.market.displayName.padEnd(12),
    dirArrow(r.direction),
    `ADX ${String(r.adx).padStart(5)}${r.adxRising ? "↑" : "↓"}`,
    `ER ${r.er.toFixed(2)}`,
    r.phase.padEnd(11),
    r.emaAligned ? "ema✓" : "ema✗",
    r.structureOk ? "struct✓" : "struct✗",
    rfdm + mt4,
  ].join("  ");
}

function rangeLine(r: MarketScan): string {
  const pos = r.pricePosition ?? 0.5;
  const edge =
    pos >= 0.8 ? "⚠ at TOP — upthrust watch" : pos <= 0.2 ? "⚠ at BOTTOM — spring watch" : `mid-range (${Math.round(pos * 100)}%)`;
  const digits = r.lastClose < 10 ? 4 : 2;
  return [
    r.market.displayName.padEnd(12),
    `box ${r.rangeLow?.toFixed(digits)}–${r.rangeHigh?.toFixed(digits)}`,
    `${r.rangeWidthAtr} ATRs`,
    edge,
    r.market.tradeable ? "" : "(not on MT4)",
  ].join("  ");
}

async function main() {
  console.log("Scanning 48 markets on H4 (live Yahoo data)...\n");
  const t0 = Date.now();
  const { results, errors } = await runScan();
  console.log(`Scanned ${results.length} markets in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach((e) => console.log(`  ${e.symbol}: ${e.message}`));
  }

  const trends = results.filter((r) => r.condition === "trend" && r.grade !== "skip");
  const fresh = trends.filter((r) => r.phase === "fresh");
  const established = trends.filter((r) => r.phase === "established");
  const bigRanges = results.filter((r) => r.condition === "big-range");
  const edgeTouches = bigRanges.filter((r) => r.pricePosition != null && (r.pricePosition >= 0.85 || r.pricePosition <= 0.15));

  console.log(`\n═══ FRESH TRENDS (ADX 20–30 rising — the prize) ═══`);
  console.log(fresh.length ? fresh.map(trendLine).join("\n") : "  none — don't force it");

  console.log(`\n═══ ESTABLISHED TRENDS ═══`);
  console.log(established.length ? established.map(trendLine).join("\n") : "  none");

  const forming = results.filter(
    (r) => r.condition === "transition" && r.score >= 55 && r.adxRising && r.direction !== "none",
  );
  console.log(`\n═══ FORMING (crawling — watch for promotion) ═══`);
  console.log(forming.length ? forming.map(trendLine).join("\n") : "  none");

  const climax = results.filter((r) => r.phase === "climax");
  console.log(`\n═══ CLIMAX — ADX 50+ (reversal hunt on the hook) ═══`);
  console.log(climax.length ? climax.map(trendLine).join("\n") : "  none");

  console.log(`\n═══ BIG RANGES (reversal watch) ═══`);
  console.log(bigRanges.length ? bigRanges.map(rangeLine).join("\n") : "  none");

  console.log(`\n═══ EDGE TOUCHES (would trigger daily Telegram alert) ═══`);
  console.log(edgeTouches.length ? edgeTouches.map(rangeLine).join("\n") : "  none");

  console.log(`\n═══ FULL RANKING ═══`);
  results.forEach((r, i) =>
    console.log(
      `${String(i + 1).padStart(2)}. ${trendLine(r)}  [${r.condition}]`,
    ),
  );

  process.exit(0); // don't let the Prisma connection hold the process open
}

main().catch((e) => {
  console.error("Scan failed:", e.message);
  process.exit(1);
});
