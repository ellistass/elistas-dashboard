// lib/screener/scan.ts — the trend-strength screener.
//
// Philosophy: this is a FOCUS-LIST tool, not an entry signal. It sweeps the
// whole universe on H4, ranks markets by trend freshness + strength, and
// answers "which markets deserve my attention this week?" — a numbers game
// instead of forcing trades. Volume/effort (David Paul) refinement is done
// manually on MT4 for the shortlist, and entries still go through the full
// RFDM layers (model declaration, H1 volume confirmation, session windows).
//
// The ADX 20–30 sweet spot: below 20 = no trend; 20–30 AND rising = trend
// forming with room to run (the prize); above 30 = established (still valid,
// later in the move); high but falling = fading, stand aside.

import { db } from "@/lib/db";
import { UNIVERSE, forexParts, type Market } from "./universe";
import { fetchH4, type Candle } from "./yahoo";
import { adxSeries, emaSeries, atrPercent, swingStructure, efficiencyRatio, rangeBounds } from "./indicators";

// "climax": ADX ≥ 50 — trend on its last leg. Never a trend entry; a reversal
// watch. The trigger is the hook: ADX pushes above 50 then turns down =
// exhaustion confirmed, go look for the reversal structure + volume climax.
export type Phase = "fresh" | "established" | "fading" | "climax" | "none";
export type Grade = "A" | "B" | "C" | "skip";

// Market condition — trend AND range are both classified, because reversals
// live in ranges. A big H4 range (4+ ATRs wide) can trend on H1 inside its
// box, and its extremes are where Model A springs/upthrusts set up.
export type Condition = "trend" | "big-range" | "tight-range" | "transition";

export interface MarketScan {
  market: Market;
  lastClose: number;
  adx: number;
  adxPrev: number; // 5 bars ago
  plusDi: number;
  minusDi: number;
  ema20: number;
  ema50: number;
  atrPct: number;
  er: number; // Kaufman Efficiency Ratio(20)
  direction: "long" | "short" | "none";
  phase: Phase;
  condition: Condition;
  rangeHigh: number | null;      // set when condition is a range
  rangeLow: number | null;
  rangeWidthAtr: number | null;  // box width in ATR(14) multiples
  pricePosition: number | null;  // 0 = range low, 1 = range high
  adxRising: boolean;
  emaAligned: boolean;
  structureOk: boolean;
  score: number; // 0–100
  grade: Grade;
  rfdmAgrees: boolean | null;
  rfdmNote: string | null;
}

export interface ScanOutcome {
  results: MarketScan[];
  errors: Array<{ symbol: string; message: string }>;
  candles: Map<string, Candle[]>; // per symbol — reused by the outcome evaluator, no extra fetches
}

// ── Scoring weights (documented so they can be tuned after journal review) ──
//   ADX zone        30 — is trend strength in/entering the tradeable zone?
//   ADX slope       15 — rising = trend developing, falling = dying
//   Efficiency      15 — Kaufman ER: is price actually going somewhere? (no lag)
//   EMA alignment   15 — price/EMA20/EMA50 stacked with the DI direction
//   Swing structure 15 — HH/HL or LH/LL confirms it's trend, not chop
//   DI separation   10 — wide DI gap = one-sided market
// The score ranks TREND quality. Ranges are classified separately via
// `condition` and surfaced as reversal-watch candidates, not scored as trends.

function scoreMarket(candles: Candle[]): Omit<MarketScan, "market" | "rfdmAgrees" | "rfdmNote"> | null {
  const adxArr = adxSeries(candles, 14);
  if (adxArr.length < 6) return null;

  const closes = candles.map((c) => c.close);
  const ema20Arr = emaSeries(closes, 20);
  const ema50Arr = emaSeries(closes, 50);
  if (!ema20Arr.length || !ema50Arr.length) return null;

  const last = adxArr[adxArr.length - 1];
  const prev = adxArr[adxArr.length - 6]; // 5 bars back
  const lastClose = closes[closes.length - 1];
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];

  const adxRising = last.adx > prev.adx + 0.5; // small deadband against noise
  const diDirection: "long" | "short" | "none" =
    last.plusDi > last.minusDi * 1.05 ? "long" : last.minusDi > last.plusDi * 1.05 ? "short" : "none";

  const emaAligned =
    diDirection === "long"
      ? lastClose > ema20 && ema20 > ema50
      : diDirection === "short"
        ? lastClose < ema20 && ema20 < ema50
        : false;

  const structure = swingStructure(candles.slice(-60));
  const structureOk = structure !== "none" && structure === diDirection;

  const er = efficiencyRatio(closes, 20);   // scoring: short window, reacts fast
  const er40 = efficiencyRatio(closes, 40); // classification: matches the range-box lookback,
                                            // so slow wide ranges (cycle > 20 bars) can't fake trendiness
  const box = rangeBounds(candles);

  // Phase
  let phase: Phase;
  if (last.adx >= 50 || (prev.adx >= 50 && !adxRising)) phase = "climax"; // hook down from 50+ still counts
  else if (last.adx < 20) phase = "none";
  else if (last.adx <= 32 && adxRising) phase = "fresh";
  else if (adxRising || last.adx >= prev.adx - 1) phase = "established";
  else phase = "fading";

  // ── Composite score ──
  let score = 0;

  // ADX zone (30): full credit 20–30, partial 15–20 and 30–45
  const a = last.adx;
  if (a >= 20 && a <= 30) score += 30;
  else if (a > 30 && a <= 45) score += 30 - ((a - 30) / 15) * 13; // 30 → 17
  else if (a >= 15 && a < 20) score += ((a - 15) / 5) * 17; // 0 → 17
  else if (a > 45) score += 10;

  // ADX slope (15)
  const slope = last.adx - prev.adx;
  if (slope > 0) score += Math.min(15, 6 + slope * 1.8); // rising: 6 base + magnitude
  else if (slope > -1.5) score += 4; // flat-ish

  // Efficiency Ratio (15): 0.3+ = clean directional travel, full credit at 0.5
  score += Math.min(15, (er / 0.5) * 15);

  // EMA alignment (15)
  if (emaAligned) score += 15;
  else if (diDirection !== "none" && (diDirection === "long" ? lastClose > ema50 : lastClose < ema50)) score += 6;

  // Swing structure (15)
  if (structureOk) score += 15;

  // DI separation (10)
  const diSum = last.plusDi + last.minusDi;
  if (diSum > 0) score += Math.min(10, (Math.abs(last.plusDi - last.minusDi) / diSum) * 25);

  score = Math.round(Math.min(100, score) * 10) / 10;

  const direction = diDirection;
  const grade: Grade =
    phase === "climax"
      ? "C" // climax is never a trend entry — reversal watch only
      : score >= 70 && phase !== "fading"
        ? "A"
        : score >= 55
          ? "B"
          : score >= 40
            ? "C"
            : "skip";

  // ── Condition: trend vs range vs transition ──
  // Trend: phase alive, direction assigned, confirmed by EMA or structure, and
  //   price actually travelling on EITHER ER window — young trends fail ER(40)
  //   because that window still contains the pre-trend range.
  // Range: ADX dead OR price going nowhere (low ER40) with no structure — but
  //   never while a fresh EMA-aligned move is underway (that's a breakout
  //   leaving the box, i.e. transition, not a range). Split by box width —
  //   4+ ATRs = big range (H1 can trend inside; extremes are spring/upthrust
  //   territory), less = tight range (skip).
  // Transition: everything else — trend forming or dying, wait for it to declare.
  let condition: Condition;
  const isTrend =
    (phase === "fresh" || phase === "established") &&
    direction !== "none" &&
    (emaAligned || structureOk) &&
    Math.max(er, er40) >= 0.2;
  const isRange = (a < 20 || (er40 < 0.2 && !structureOk)) && !(phase === "fresh" && emaAligned);
  if (isTrend) condition = "trend";
  else if (isRange && box) condition = box.widthAtr >= 4 ? "big-range" : "tight-range";
  else condition = "transition";

  return {
    lastClose,
    adx: round2(last.adx),
    adxPrev: round2(prev.adx),
    plusDi: round2(last.plusDi),
    minusDi: round2(last.minusDi),
    ema20: round6(ema20),
    ema50: round6(ema50),
    atrPct: round2(atrPercent(candles)),
    er: round2(er),
    direction,
    phase,
    condition,
    rangeHigh: condition.endsWith("range") && box ? round6(box.high) : null,
    rangeLow: condition.endsWith("range") && box ? round6(box.low) : null,
    rangeWidthAtr: condition.endsWith("range") && box ? round2(box.widthAtr) : null,
    pricePosition: condition.endsWith("range") && box ? round2(box.pricePosition) : null,
    adxRising,
    emaAligned,
    structureOk,
    score,
    grade,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

// ── RFDM cross-check ──────────────────────────────────────────────────────────
// For forex pairs: does the screener's direction agree with the latest currency
// rankings? Long EUR/USD agrees when EUR ranks above USD.

async function rfdmRankings(): Promise<Map<string, number> | null> {
  const latest = await db.currencyScore.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  if (!latest) return null;
  const rows = await db.currencyScore.findMany({
    where: { date: latest.date },
    orderBy: { score: "desc" },
    select: { currency: true },
  });
  if (!rows.length) return null;
  return new Map(rows.map((r, i) => [r.currency, i + 1])); // 1 = strongest
}

function rfdmCheck(
  market: Market,
  direction: "long" | "short" | "none",
  rankings: Map<string, number> | null,
): { rfdmAgrees: boolean | null; rfdmNote: string | null } {
  const parts = forexParts(market.symbol);
  if (!parts || !rankings || direction === "none") return { rfdmAgrees: null, rfdmNote: null };
  const baseRank = rankings.get(parts.base);
  const quoteRank = rankings.get(parts.quote);
  if (baseRank == null || quoteRank == null) return { rfdmAgrees: null, rfdmNote: null };

  const baseStronger = baseRank < quoteRank; // lower rank number = stronger
  const agrees = direction === "long" ? baseStronger : !baseStronger;
  return {
    rfdmAgrees: agrees,
    rfdmNote: `RFDM: ${parts.base} #${baseRank}, ${parts.quote} #${quoteRank} — ${agrees ? "agrees" : "conflicts"} with ${direction}`,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runScan(): Promise<ScanOutcome> {
  const rankings = await rfdmRankings().catch(() => null);
  const results: MarketScan[] = [];
  const errors: Array<{ symbol: string; message: string }> = [];
  const candlesBySymbol = new Map<string, Candle[]>();

  // Small batches — polite to Yahoo, fast enough for a cron.
  const BATCH = 5;
  for (let i = 0; i < UNIVERSE.length; i += BATCH) {
    const batch = UNIVERSE.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (market) => {
        const candles = await fetchH4(market.symbol);
        candlesBySymbol.set(market.symbol, candles);
        const scored = scoreMarket(candles);
        if (!scored) throw new Error("insufficient candle history");
        return { market, ...scored, ...rfdmCheck(market, scored.direction, rankings) };
      }),
    );
    settled.forEach((s, j) => {
      if (s.status === "fulfilled") results.push(s.value);
      else errors.push({ symbol: batch[j].symbol, message: s.reason?.message ?? String(s.reason) });
    });
  }

  results.sort((x, y) => y.score - x.score);
  return { results, errors, candles: candlesBySymbol };
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function persistScan(outcome: ScanOutcome, runType: string): Promise<string> {
  const run = await db.scanRun.create({
    data: {
      runType,
      universe: UNIVERSE.length,
      scanned: outcome.results.length,
      errors: outcome.errors.length ? JSON.stringify(outcome.errors) : null,
      results: {
        create: outcome.results.map((r) => ({
          symbol: r.market.symbol,
          displayName: r.market.displayName,
          assetClass: r.market.assetClass,
          tradeable: r.market.tradeable,
          lastClose: r.lastClose,
          adx: r.adx,
          adxPrev: r.adxPrev,
          plusDi: r.plusDi,
          minusDi: r.minusDi,
          ema20: r.ema20,
          ema50: r.ema50,
          atrPct: r.atrPct,
          er: r.er,
          direction: r.direction,
          phase: r.phase,
          condition: r.condition,
          rangeHigh: r.rangeHigh,
          rangeLow: r.rangeLow,
          rangeWidthAtr: r.rangeWidthAtr,
          pricePosition: r.pricePosition,
          adxRising: r.adxRising,
          emaAligned: r.emaAligned,
          structureOk: r.structureOk,
          score: r.score,
          grade: r.grade,
          rfdmAgrees: r.rfdmAgrees,
          rfdmNote: r.rfdmNote,
        })),
      },
    },
  });
  return run.id;
}
