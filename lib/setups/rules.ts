// lib/setups/rules.ts — the mechanical setups, exactly as backtested.
//
// This is NOT the Wyckoff read. The desk is where you read a range and lock a
// call. This file answers a narrower question: "has a setup printed that fits
// the rules we measured?" Every constant below came from the Sep 2026 daily
// backtest (84 instruments, 5y, scripts in outputs/backtest/). Change them only
// with a re-run behind the change.
//
// Two entries, both mirrored long/short:
//
//   CONSERVATIVE — the retest after a break with effort.
//     1. A bar CLOSES beyond the edge within 3 bars of the range ending, on
//        1.0–2.0× the range's average volume. The FIRST such bar counts (that's
//        the day you'd act). <1× = no effort (−0.15R); ≥2× = climactic (−0.43R).
//     2. Limit order at the broken edge. Cancel if the day opens THROUGH the
//        edge (gap) — you would be filled at a price the plan never priced.
//     3. Stop 1.5 × tol back inside. Order valid for 20 bars after the break.
//     Live result: ~182 trades/yr across the basket, +0.39R, DD −11R.
//     Retest volume is NOT a filter: it's only known after the fill, and
//     bailing on loud fill days cut the result to +0.16R.
//
//   AGGRESSIVE — the spring / upthrust, before any break.
//     1. The range is recognisable in real time: ≥ MINLEN bars, both edges touched.
//     2. The test bar: low pierces the floor and closes back inside (spring) /
//        high pierces the ceiling and closes back inside (upthrust).
//     3. Test volume ≤ 1.0× the range average (so far).  High-volume tests: ~+0.1R.
//     4. Shallow: pierced by ≤ 10% of the band. Deep tests: ~0R.
//     5. Monthly trend NOT against the trade. Against: +0.10R, DD −19R.
//     Entry: the NEXT OPEN after the test closes (skip if it opens past the
//     stop). Stop ¼ tol beyond the test's wick.
//     Result: ~76 trades/yr, ~+0.46R.  With weekly trend WITH: ~+0.55R (grade A).
//
//   MANAGEMENT (both): stop to breakeven at +1R, then trail 1R behind the best
//   price. Target (hard cap): the far edge + one band. Tested best on drawdown.
//
// Everything here is pure: bars in, setups out. No I/O, no clock.

import { CFG, detectRanges, contextPct, engineVerdict, type Bar, type DetectedRange } from "@/lib/wyckoff/engine";
import { rollMask, goodAvgVolume } from "./roll";

export const RULES = {
  BREAK_WINDOW: 3,
  BREAK_VOL_MIN: 1.0,
  BREAK_VOL_MAX: 2.0,
  CONS_STOP_TOL: 1.5,
  CONS_VALID_BARS: 20,
  TEST_VOL_MAX: 1.0,
  TEST_DEPTH_MAX: 0.10,
  AGGR_STOP_TOL: 0.25,
  /** Retest volume ≤ this × range avg = a quiet pullback (the real LPS/LPSY).
   *  Fair-fill backtest, 84 futures & stocks: low +0.48R (n=99, halves +0.50/+0.48),
   *  mid +0.17R, high +0.21R; low + reversal break +0.73R (n=48). */
  RETEST_LOW_VOL: 0.8,
} as const;

export type Side = "long" | "short";
export type Entry = "conservative" | "aggressive";
export type Trend = "with" | "mixed" | "against" | "unknown";

export type SetupState =
  | "armed"      // conservative: break qualified, limit order at the edge is live
  | "filled"     // price reached the entry on the latest bar
  | "trigger";   // aggressive: the test printed, entry is live

export interface Check { label: string; pass: boolean; value?: string }

/** The exact orders to place. Directions are in READ terms (long/short on the
 *  instrument read); the page flips them for inverted futures (6C/6J/6S). */
export interface OrderPlan {
  /** Entry order. */
  entry:
    | { kind: "limit"; price: number; goodFor: number; cancelIf: string }
    | { kind: "market-on-open"; skipIf: string };
  /** Protective stop, placed with the entry (or right after the fill). */
  stopLoss: number;
  /** Take-profit limit at the cap. */
  takeProfit: number;
  /** What to do after the fill. */
  manage: string[];
}

/** The retest bar, read at its close (conservative, once filled). */
export interface RetestRead {
  /** Retest bar volume ÷ range average; null = unreadable (roll / bad print). */
  vol: number | null;
  /** vol ≤ RETEST_LOW_VOL. null when unreadable. */
  low: boolean | null;
  /** Closed back on the break side of the edge (the level held). */
  held: boolean;
  /** Confirmation entry (wait for the close, enter at the next open): held AND low.
   *  Backtest: +0.36R (n=61) vs +0.27R for "held, any volume". */
  confirmEntry: boolean;
}

export interface Setup {
  entry: Entry;
  side: Side;
  state: SetupState;
  grade: "A" | "B";
  /** The deciding bar's volume couldn't be read (futures contract roll / bad print). */
  volumeUnverified: boolean;
  rangeLo: number;
  rangeHi: number;
  rangeStart: string;
  /** The bar that made this a setup: the break bar or the test bar. */
  signalDate: string;
  entryPrice: number;
  stop: number;
  /** +1R: where the stop moves to breakeven. */
  breakevenAt: number;
  /** Hard cap: far edge + one band. */
  target: number;
  /** Bars the order stays valid for (null = act now, at/near the close). */
  barsLeft: number | null;
  context: { daily: "reversal" | "with-trend" | "unknown"; weekly: Trend; monthly: Trend };
  /** Hard rules (all pass, or it isn't a setup) followed by soft grading tags. */
  checks: Check[];
  order: OrderPlan;
  /** The engine's accumulation/distribution read of the range, measured only on
   *  bars up to the signal (effort per point of travel, up vs down).
   *  Backtest: on the conservative entry, agrees +0.56R / neutral +0.43R /
   *  disagrees +0.38R. On the aggressive entry it did NOT help. */
  setupRead: { verdict: "accum" | "distrib" | "neutral"; agrees: boolean | null };
  /** Conservative only, and only when the edge was touched on the last bar. */
  retest: RetestRead | null;
  notes: string[];
}

// ── Higher-timeframe context (completed periods only) ────────────────────────
const weekKey = (d: string) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};
const monthKey = (d: string) => d.slice(0, 7);

function periodCloses(bars: Bar[], key: (d: string) => string) {
  const keys: string[] = [], closes: number[] = [];
  for (const b of bars) {
    const k = key(b.date);
    if (keys[keys.length - 1] !== k) { keys.push(k); closes.push(b.c); } else closes[closes.length - 1] = b.c;
  }
  return { keys, closes };
}
const sma = (a: number[], n: number, i: number) =>
  i + 1 < n ? NaN : a.slice(i + 1 - n, i + 1).reduce((s, x) => s + x, 0) / n;

/** Trend of the last period COMPLETED before `day`: close vs fast vs slow, slow rising/falling. */
export function htfTrend(bars: Bar[], day: string, tf: "weekly" | "monthly", side: Side): Trend {
  const key = tf === "weekly" ? weekKey : monthKey;
  const [fast, slow] = tf === "weekly" ? [10, 30] : [6, 12];
  const P = periodCloses(bars, key);
  const i = P.keys.indexOf(key(day)) - 1;
  if (i < slow + 3) return "unknown";
  const c = P.closes[i], f = sma(P.closes, fast, i), s = sma(P.closes, slow, i), s3 = sma(P.closes, slow, i - 3);
  const t = c > f && f > s && s > s3 ? "up" : c < f && f < s && s < s3 ? "down" : "mixed";
  if (t === "mixed") return "mixed";
  return (t === "up") === (side === "long") ? "with" : "against";
}

const readOf = (v: "accum" | "distrib" | "neutral", long: boolean) =>
  ({ verdict: v, agrees: v === "neutral" ? null : (v === "accum") === long });

const avgOf = (xs: Bar[], f: (b: Bar) => number) => xs.reduce((s, b) => s + f(b), 0) / xs.length;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

// ── Conservative ─────────────────────────────────────────────────────────────
export function conservative(bars: Bar[], r: DetectedRange): Setup | null {
  if (r.status !== "broken") return null;
  const n = bars.length, band = r.hi - r.lo, tol = band * CFG.TOL_FRAC;
  const eb = bars[r.end];
  const long = eb.c > r.hi + tol;
  if (!long && !(eb.c < r.lo - tol)) return null;                 // MAXLEN close, not a break
  const side: Side = long ? "long" : "short";

  const inR = bars.slice(r.start, r.end);
  const mask = rollMask(bars);
  const avgV = goodAvgVolume(bars, mask, r.start, r.end);
  if (!(avgV > 0)) return null;

  // First bar in the window that closed beyond the edge on 1–2× volume.
  let bi = -1, bV = 0, unverified = false;
  for (let i = r.end; i < Math.min(r.end + RULES.BREAK_WINDOW, n); i++) {
    const b = bars[i], v = b.v / avgV;
    if (!(long ? b.c > r.hi : b.c < r.lo)) continue;
    // Roll-week bar: the volume is fake, so the rule can't be checked. Keep the
    // setup but mark it, rather than silently passing or failing it.
    if (mask[i]) { bi = i; bV = NaN; unverified = true; break; }
    if (v >= RULES.BREAK_VOL_MIN && v < RULES.BREAK_VOL_MAX) { bi = i; bV = v; break; }
  }
  if (bi < 0) return null;

  const edge = long ? r.hi : r.lo;
  const stop = long ? r.hi - RULES.CONS_STOP_TOL * tol : r.lo + RULES.CONS_STOP_TOL * tol;
  const target = long ? r.hi + band : r.lo - band;
  const lastValid = r.end + RULES.CONS_VALID_BARS - 1;
  if (n - 1 > lastValid) return null;                               // order window over

  // Walk the bars after the break. First touch of the edge = the fill (or a
  // cancel if that day opened through the edge). Target first = missed it.
  let state: SetupState = "armed";
  let retest: RetestRead | null = null;
  for (let k = bi + 1; k < n; k++) {
    const b = bars[k];
    if (long ? b.h >= target : b.l <= target) return null;           // ran away without a retest
    if (long ? b.l <= edge : b.h >= edge) {
      if (long ? b.o < edge : b.o > edge) return null;               // gapped through → order cancelled
      if (k === n - 1) {
        state = "filled";
        // The retest bar is COMPLETE (completedBars), so its volume is known now.
        const vol = mask[k] ? null : b.v / avgV;
        const low = vol == null ? null : vol <= RULES.RETEST_LOW_VOL;
        const held = long ? b.c > edge : b.c < edge;
        const stopped = long ? b.l <= stop : b.h >= stop;
        retest = { vol: vol == null ? null : r6(vol), low, held, confirmEntry: held && low === true && !stopped };
        break;
      }
      return null;                                                    // filled earlier: it's a trade now, not a setup
    }
  }

  const ctx = contextPct(bars, r.start);
  const daily = ctx == null ? "unknown" : (long ? ctx < 0 : ctx > 0) ? "reversal" : "with-trend";
  const today = bars[n - 1].date;
  const weekly = htfTrend(bars, today, "weekly", side), monthly = htfTrend(bars, today, "monthly", side);
  const risk = Math.abs(edge - stop);

  return {
    entry: "conservative", side, state,
    // Reversal ranges: +0.58R vs +0.17R with-trend (fixed exits); weekly with: +0.57R.
    // A quiet retest also makes it A: low-volume retests +0.48R vs +0.23R for all.
    grade: !unverified && ((daily === "reversal" && weekly !== "against") || retest?.low === true) ? "A" : "B",
    volumeUnverified: unverified,
    rangeLo: r.lo, rangeHi: r.hi, rangeStart: bars[r.start].date, signalDate: bars[bi].date,
    entryPrice: r6(edge), stop: r6(stop),
    breakevenAt: r6(long ? edge + risk : edge - risk), target: r6(target),
    barsLeft: lastValid - (n - 1),
    context: { daily, weekly, monthly },
    setupRead: readOf(engineVerdict(bars, r.start, r.end), long),
    retest,
    order: {
      entry: {
        kind: "limit", price: r6(edge), goodFor: lastValid - (n - 1),
        cancelIf: `the day opens ${long ? "below" : "above"} ${r6(edge)} (gap through the edge)`,
      },
      stopLoss: r6(stop), takeProfit: r6(target),
      manage: ["At +1R: move the stop to breakeven (entry).", "After that: trail the stop 1R behind the best price.", "Leave the take-profit at the cap."],
    },
    checks: [
      { label: `closed ${long ? "above" : "below"} the range`, pass: true, value: bars[bi].date },
      unverified
        ? { label: "break volume — UNAVAILABLE (contract roll / bad print)", pass: false, value: "check manually" }
        : { label: "break volume 1.0–2.0× range avg", pass: true, value: `${bV.toFixed(2)}×` },
      { label: "within 20 bars of the break", pass: true, value: `${n - 1 - r.end} bars` },
      { label: "range followed a move the other way (reversal)", pass: daily === "reversal" },
      { label: "weekly trend not against", pass: weekly !== "against", value: weekly },
      ...(retest
        ? [retest.vol == null
            ? { label: "retest volume — UNAVAILABLE (contract roll / bad print)", pass: false, value: "check manually" }
            : { label: `retest on LOW volume (≤ ${RULES.RETEST_LOW_VOL}× range avg)`, pass: retest.low === true, value: `${retest.vol.toFixed(2)}×` },
           { label: `retest held the ${long ? "ceiling" : "floor"} at the close`, pass: retest.held }]
        : []),
    ],
    notes: [
      `Limit ${long ? "buy" : "sell"} at the ${long ? "ceiling" : "floor"}. Cancel if the day opens ${long ? "below" : "above"} it.`,
      "Retest volume is read at the close of the fill day: a quiet retest is the stronger trade (+0.48R vs +0.2R).",
      "Prefer confirmation? Skip the limit; if the retest day closes holding the edge on low volume, enter at the next open (+0.36R).",
    ],
  };
}

// ── Aggressive ───────────────────────────────────────────────────────────────
// Entry is the NEXT OPEN after the test bar closes (for US stocks that's the
// cash open, 2:30pm Lagos in summer time). Tested against entering at the test
// close: +0.46R vs +0.38R — and at the open the test is fully confirmed. Skip
// if the open is already beyond the stop.
export function aggressive(bars: Bar[], r: DetectedRange, side: Side): Setup | null {
  const n = bars.length, band = r.hi - r.lo, tol = band * CFG.TOL_FRAC;
  const long = side === "long";
  const endK = r.status === "open" ? n : r.end;                      // only tests INSIDE the range

  // Find the first test once the range is recognisable, as a live scanner would.
  let hitHi = 0, hitLo = 0, k = -1;
  for (let i = r.start + CFG.SEED; i < endK; i++) {
    const b = bars[i];
    const valid = i - r.start >= CFG.MINLEN - 1 && hitHi >= 1 && hitLo >= 1;
    if (valid && (long ? b.l < r.lo && b.c >= r.lo : b.h > r.hi && b.c <= r.hi)) { k = i; break; }
    if (b.h >= r.hi - tol) hitHi++;
    if (b.l <= r.lo + tol) hitLo++;
  }
  // Live only on the day the test is the LAST completed bar: the next open is the entry.
  if (k !== n - 1) return null;

  const b = bars[k];
  const mask = rollMask(bars);
  const avgV = goodAvgVolume(bars, mask, r.start, k);
  const unverified = mask[k];
  const tV = unverified ? NaN : b.v / avgV;
  const depth = (long ? r.lo - b.l : b.h - r.hi) / band;
  const monthly = htfTrend(bars, b.date, "monthly", side);
  const weekly = htfTrend(bars, b.date, "weekly", side);
  if ((!unverified && !(tV <= RULES.TEST_VOL_MAX)) || !(avgV > 0) || depth > RULES.TEST_DEPTH_MAX || monthly === "against") return null;

  const stop = long ? b.l - RULES.AGGR_STOP_TOL * tol : b.h + RULES.AGGR_STOP_TOL * tol;
  const ref = b.c;                                                   // the open will be near this; risk is re-measured from the fill
  const risk = Math.abs(ref - stop);
  const ctx = contextPct(bars, r.start);
  return {
    entry: "aggressive", side, state: "trigger",
    grade: !unverified && weekly === "with" ? "A" : "B",
    volumeUnverified: unverified,
    rangeLo: r.lo, rangeHi: r.hi, rangeStart: bars[r.start].date, signalDate: b.date,
    entryPrice: r6(ref), stop: r6(stop),
    breakevenAt: r6(long ? ref + risk : ref - risk),
    target: r6(long ? r.hi + band : r.lo - band),
    barsLeft: null,
    context: { daily: ctx == null ? "unknown" : (long ? ctx < 0 : ctx > 0) ? "reversal" : "with-trend", weekly, monthly },
    setupRead: readOf(engineVerdict(bars, r.start, k), long),
    retest: null,
    order: {
      entry: { kind: "market-on-open", skipIf: `the open is already ${long ? "at or below" : "at or above"} the stop ${r6(stop)}` },
      stopLoss: r6(stop), takeProfit: r6(long ? r.hi + band : r.lo - band),
      manage: ["Re-measure 1R from your actual fill price.", "At +1R: move the stop to breakeven (entry).", "After that: trail the stop 1R behind the best price.", "Leave the take-profit at the cap."],
    },
    checks: [
      { label: `${long ? "spring" : "upthrust"}: pierced and closed back inside`, pass: true, value: b.date },
      unverified
        ? { label: "test volume — UNAVAILABLE (contract roll / bad print)", pass: false, value: "check manually" }
        : { label: "test volume ≤ 1.0× range avg", pass: true, value: `${tV.toFixed(2)}×` },
      { label: "shallow: ≤ 10% of the band", pass: true, value: `${(depth * 100).toFixed(0)}%` },
      { label: "monthly trend not against", pass: true, value: monthly },
      { label: "weekly trend with the trade", pass: weekly === "with", value: weekly },
    ],
    notes: [
      `${long ? "Buy" : "Sell"} at the next open. Skip it if the open is already ${long ? "below" : "above"} the stop.`,
      "Entry shown is the test's close — size from the actual fill; +1R moves with it.",
    ],
  };
}

/** Every live setup on one instrument's daily bars (completed bars only). */
export function findSetups(bars: Bar[]): Setup[] {
  const out: Setup[] = [];
  const ranges = detectRanges(bars).slice(-3);                      // only the recent structure can be live
  for (const r of ranges) {
    const c = conservative(bars, r); if (c) out.push(c);
    for (const s of ["long", "short"] as const) { const a = aggressive(bars, r, s); if (a) out.push(a); }
  }
  return out;
}
