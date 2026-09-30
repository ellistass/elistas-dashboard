// lib/setups/forexDriver.ts — the forex DRIVER setup. Forex only.
//
// Where the fundamentals and the technicals line up:
//   1. A pair trends for months, then stalls into a range at the end of it.
//   2. The range breaks AGAINST that trend (a reversal break).
//   3. Driver (shown, not required): the currency you're selling is cracking
//      against EVERYONE — a new 20-day low on its strength index in the 5 days
//      up to the break — while the one you're buying holds. Go read why.
//   4. Entry: a limit at the broken edge (the retest). Stop 1.5 × tolerance
//      back inside the range. Break-even at +1R, then trail 1R behind the best
//      price, time exit at 60 days.
//
// Tested Sep 2026, 28 pairs, NY-close candles, FAIR fills (on the fill day only
// the stop can be hit — its high/low may have printed before the order filled):
//   reversal-break retest       n=129  +0.19R ±0.29 gross, +0.14R after a 2-pip spread
//   with price-only "driver"    n=74   +0.14R      without  n=55  +0.26R
//   high-vol regime             n=43   −0.11R      normal/low vol  n=86  +0.34R
//   LOW-volume retest (futures legs ≤0.8×)  +0.34R (n=26) vs +0.22R not low
// Not a proven edge on its own (the ±0.29 band includes zero) — this section is a
// FORWARD TEST. The quiet retest and a normal-vol market are what to look for.
//
// News drivers were tested separately (central-bank / US CPI & jobs dates, event-day
// move ≥1σ, then a crack): reversal retests after news ≈ the same as without. Breaks
// WITH the trend right after a central-bank move failed (−0.50R, n=52, 2021–26).
// The driver is therefore INFORMATION: "go read the news", never a grade.
//
// Real-money positioning (CFTC, weekly) over the range IS graded as a warning:
// real money already selling the currency you sell = late (−0.39R / −0.16R);
// still buying it = trapped fuel (+0.48R / +0.34R). See lib/data/cot.ts.
//
// WHY OUR OWN CANDLES: Yahoo's daily "close" for spot FX is stale (EURAUD
// 23 Sep 2026 showed 1.6096 = the 03:00 price; the real NY close was ~1.616).
// Daily bars here are rebuilt from 1h bars, session = 17:00 → 17:00 New York.
//
// Spot FX has no volume: the retest read uses the currency futures (6E, 6A, …).
//
// Separate from lib/setups/rules.ts (volume-based) and from the Wyckoff desk.

import axios from "axios";
import { detectRanges, contextPct, engineVerdict, CFG, type Bar, type DetectedRange } from "@/lib/wyckoff/engine";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { rollMask } from "./roll";
import { storedVolume, patchVolume } from "@/lib/data/futuresVolume";
import { fetchCot, positioningRead, type PositioningRead, type CotSeries } from "@/lib/data/cot";
import { abcdFor, type AbcdSetup } from "./abcd";

export const CCY = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"] as const;
export type Ccy = (typeof CCY)[number];
/** The 28 pairs, in market convention order (EURUSD, not USDEUR). */
export const PAIRS: string[] = CCY.flatMap((a, i) => CCY.slice(i + 1).map((b) => a + b));

export const DRIVER = {
  LOW_LOOKBACK: 20,     // "cracking" = a new 20-day low on the strength index…
  LOW_WINDOW: 5,        // …printed in the 5 days up to (and including) the break bar
  RETEST_BARS: 20,      // the retest limit stays live 20 bars after the break
  STOP_TOL: 1.5,        // stop = 1.5 × tolerance back inside the edge
  MAX_HOLD: 60,         // time exit
  RETEST_LOW_VOL: 0.8,  // retest volume (currency futures legs) ≤ 0.8× range avg = quiet retest → grade A
  PRESS_FRAC: 0.33,     // "watch": last close in the outer third of the band (or a wick into the edge zone)
} as const;

export type DriverState = "watch" | "armed" | "filled";

export interface DriverSetup {
  pair: string;                // "EURAUD" — trade the spot pair as-is, never inverted
  side: "long" | "short";
  state: DriverState;
  /** A = COT trapped z≥1 — the only tradeable forex grade (set by scanForexDrivers). */
  grade: "A" | "B";
  /** Why not to trade it (COT not trapped, selling USD, no COT). null = tradeable. */
  skip: string | null;
  /** Wyckoff effort read over the range on the currency futures volume (legs averaged).
   *  Tested as a WARNING only: disagrees → −0.33R / −0.49R on the retest. */
  wyckoffRead: { verdict: "accum" | "distrib" | "neutral" | "n/a"; agrees: boolean | null };
  /** COT on the SELL leg: the break evening, then each new weekly report up to the
   *  evening before the fill (or today while the limit waits). */
  cotPath: CotStep[];
  range: { start: string; end: string; lo: number; hi: number; bars: number };
  /** Size of the trend before the range, in ATRs (negative = down). */
  trendAtr: number;
  breakDate: string | null;    // null while "watch"
  barsSinceBreak: number | null;
  /** Level a daily CLOSE has to clear to count as the break (edge ± tolerance). */
  breakLevel: number;
  driver: {
    confirmed: boolean;
    loser: Ccy;                // the currency you're selling
    winner: Ccy;               // the currency you're buying
    loserLowDate: string | null;   // when the loser printed its 20-day low (null = hasn't)
    winnerCracking: boolean;       // true = both sides weak → not a clean driver
  };
  order: {
    entry: number;             // limit at the edge
    stopLoss: number;
    breakEven: number;         // +1R
    goodForBars: number;       // bars left on the limit
    manage: string[];
  };
  checks: { label: string; pass: boolean; value?: string }[];
  /** Retest day read at its close (state "filled" only). Volume comes from the
   *  currency FUTURES of the pair's non-USD legs (spot FX has none). */
  retest: { vol: number | null; low: boolean | null; held: boolean; confirmEntry: boolean } | null;
  /** Real money (CFTC asset managers) in each leg from range start → now. The SELL
   *  leg is the tested read: still buying it = trapped fuel ✓, already selling = late ⚠. */
  positioning: PositioningRead | null;
  /** Last 60 days of both strength indices, rebased to 0 — for the card sparkline. */
  strength: { dates: string[]; loser: number[]; winner: number[] };
  /** Chart window: the range plus context, [o,h,l,c,date] on NY-close candles. */
  bars: [number, number, number, number, string][];
  lastBarDate: string;
}

export interface CotStep { at: string; state: "A" | "B" | "flat" | "late" | "n/a"; z: number | null }

const cotState = (l: PositioningRead["sell"]): CotStep["state"] =>
  l.verdict === "trapped" ? ((l.z ?? 0) >= 1 ? "A" : "B") : l.verdict;

/** Break evening + one step per report that became known after it, up to `until`. */
function cotPathFor(cot: CotSeries, buy: string, sell: string, rangeStart: string, breakDate: string, until: string): CotStep[] {
  const step = (at: string): CotStep => { const l = positioningRead(cot, buy, sell, rangeStart, at).sell; return { at, state: cotState(l), z: l.z }; };
  const out = [step(breakDate)];
  for (const p of cot[sell] ?? []) if (p.known > breakDate && p.known <= until) out.push(step(p.known));
  return out;
}

// ── Strength index ────────────────────────────────────────────────────────────
// Each currency's average daily log-move against the other seven, cumulated.
// A day counts only when ALL 28 pairs printed (same as the backtest).
export interface StrengthIndex { dates: string[]; idx: Record<Ccy, number[]> }

export function strengthIndex(pairs: Record<string, Bar[]>): StrengthIndex {
  const px: Record<string, Map<string, number>> = {};
  for (const p of PAIRS) px[p] = new Map((pairs[p] ?? []).map((b) => [b.date, b.c]));
  const dates = [...px[PAIRS[0]].keys()].filter((d) => PAIRS.every((p) => px[p].has(d))).sort();
  const idx = Object.fromEntries(CCY.map((c) => [c, [0]])) as Record<Ccy, number[]>;
  for (let t = 1; t < dates.length; t++) {
    const r = Object.fromEntries(CCY.map((c) => [c, [] as number[]])) as Record<Ccy, number[]>;
    for (const p of PAIRS) {
      const x = Math.log(px[p].get(dates[t])! / px[p].get(dates[t - 1])!);
      if (!Number.isFinite(x) || Math.abs(x) > 0.08) continue;          // bad print guard
      r[p.slice(0, 3) as Ccy].push(x);
      r[p.slice(3) as Ccy].push(-x);
    }
    for (const c of CCY) idx[c].push(idx[c][t - 1] + (r[c].length ? r[c].reduce((s, x) => s + x, 0) / r[c].length : 0));
  }
  return { dates, idx };
}

/** Index position of `date`, or the last index date before it. */
function at(si: StrengthIndex, date: string): number {
  let lo = 0, hi = si.dates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (si.dates[m] <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

/** Date of a new 20-day low on `c`'s index in the 5 days up to t (null = none). */
function crackedAt(si: StrengthIndex, c: Ccy, t: number): string | null {
  const s = si.idx[c];
  for (let k = t; k > t - DRIVER.LOW_WINDOW; k--) {
    if (k < DRIVER.LOW_LOOKBACK + 5) return null;
    if (s[k] <= Math.min(...s.slice(k - DRIVER.LOW_LOOKBACK, k))) return si.dates[k];
  }
  return null;
}
/** Mirror of crackedAt: a new 20-day HIGH (the currency is surging against everyone). */
function surgedAt(si: StrengthIndex, c: Ccy, t: number): string | null {
  const s = si.idx[c];
  for (let k = t; k > t - DRIVER.LOW_WINDOW; k--) {
    if (k < DRIVER.LOW_LOOKBACK + 5) return null;
    if (s[k] >= Math.max(...s.slice(k - DRIVER.LOW_LOOKBACK, k))) return si.dates[k];
  }
  return null;
}

// ── "Go check the fundamentals" alerts ───────────────────────────────────────
// The math can't tell you WHY a currency moved — only THAT it moved against all
// seven others at once, which is what a currency-specific story (rates, data,
// commodities, risk) looks like. So: any currency at a new 20-day low or high on
// its index in the last 5 days = go find the reason. No ranges needed for this.
export interface CurrencyAlert { ccy: Ccy; move: "cracking" | "surging"; date: string; change20d: number }

export function currencyAlerts(si: StrengthIndex): CurrencyAlert[] {
  const t = si.dates.length - 1;
  const out: CurrencyAlert[] = [];
  for (const c of CCY) {
    const s = si.idx[c];
    const change20d = t >= 20 ? (s[t] - s[t - 20]) * 100 : 0;      // % vs the basket over 20 days
    const lo = crackedAt(si, c, t), hi = surgedAt(si, c, t);
    if (lo) out.push({ ccy: c, move: "cracking", date: lo, change20d });
    else if (hi) out.push({ ccy: c, move: "surging", date: hi, change20d });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ── Currency futures volume (for the retest read) ─────────────────────────────
// Spot has no volume; the CME futures do (roll-masked, real totals where stored).
const FUT: Partial<Record<Ccy, string>> = { EUR: "6E", GBP: "6B", AUD: "6A", NZD: "6N", CAD: "6C", JPY: "6J", CHF: "6S" };
export type FutVol = Partial<Record<Ccy, Map<string, number>>>;   // date → trusted volume (bad prints dropped)

function legVolRatio(pair: string, fv: FutVol | undefined, rangeDates: string[], at: string): number | null {
  if (!fv) return null;
  const rs: number[] = [];
  for (const c of [pair.slice(0, 3), pair.slice(3)] as Ccy[]) {
    const m = fv[c]; if (!m) continue;                              // USD leg: no future of its own
    const v = m.get(at); if (v == null) continue;
    const hist = rangeDates.map((d) => m.get(d)).filter((x): x is number => x != null);
    if (hist.length < 5) continue;
    rs.push(v / (hist.reduce((a, x) => a + x, 0) / hist.length));
  }
  return rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null;
}

/** Wyckoff effort read (lib/wyckoff/engine.engineVerdict) with the futures legs' volume
 *  averaged onto the spot bars, over bars[start, end) — the range only, as tested. */
function wyckoffReadFor(pair: string, bars: Bar[], fv: FutVol | undefined, start: number, end: number, up: boolean): DriverSetup["wyckoffRead"] {
  if (!fv) return { verdict: "n/a", agrees: null };
  const legs = [pair.slice(0, 3), pair.slice(3)].map((c) => fv[c as Ccy]).filter((m): m is Map<string, number> => !!m);
  if (!legs.length) return { verdict: "n/a", agrees: null };
  let have = 0;
  const vb = bars.slice(start, end).map((b) => {
    const vs = legs.map((m) => m.get(b.date)).filter((x): x is number => x != null);
    if (vs.length) have++;
    return { ...b, v: vs.length ? vs.reduce((a, x) => a + x, 0) / vs.length : 0 };
  });
  if (vb.length < 5 || have < vb.length * 0.8) return { verdict: "n/a", agrees: null };
  const verdict = engineVerdict(vb, 0, vb.length);
  return { verdict, agrees: verdict === "neutral" ? null : verdict === (up ? "accum" : "distrib") };
}

// ── One pair ──────────────────────────────────────────────────────────────────
function atr20(bars: Bar[], end: number): number {
  let a = 0;
  for (let k = end - 20; k < end; k++) a += Math.max(bars[k].h, bars[k - 1].c) - Math.min(bars[k].l, bars[k - 1].c);
  return a / 20;
}

export function driverSetupFor(pair: string, bars: Bar[], si: StrengthIndex, fv?: FutVol): DriverSetup | null {
  const n = bars.length;
  if (n < 150) return null;
  const B = pair.slice(0, 3) as Ccy, Q = pair.slice(3) as Ccy;
  const last = n - 1;

  // The most recent range that is either still open, or broke within the retest window.
  const ranges = detectRanges(bars).filter((r) => r.status === "open" || r.end >= last - DRIVER.RETEST_BARS);
  const r: DetectedRange | undefined = ranges[ranges.length - 1];
  if (!r || r.start < CFG.CONTEXT_BARS + 21) return null;

  const ctx = contextPct(bars, r.start);
  if (ctx == null || ctx === 0) return null;
  const side: "long" | "short" = ctx < 0 ? "long" : "short";      // reversal = against the prior trend
  const up = side === "long";
  const band = r.hi - r.lo, tol = band * CFG.TOL_FRAC;
  const edge = up ? r.hi : r.lo;
  const breakLevel = up ? r.hi + tol : r.lo - tol;
  const loser = up ? Q : B, winner = up ? B : Q;                  // long B/Q = sell Q, buy B
  const atr = atr20(bars, r.start);
  const trendAtr = (bars[r.start].c - bars[r.start - CFG.CONTEXT_BARS].c) / atr;

  let state: DriverState, breakIdx: number | null = null;
  let retest: DriverSetup["retest"] = null;
  if (r.status === "broken") {
    const eb = bars[r.end];
    // Only reversal breaks count. A break the other way (trend resuming) is not this setup.
    if (up ? !(eb.c > breakLevel) : !(eb.c < breakLevel)) return null;
    breakIdx = r.end;
    // Walk the bars after the break: first touch of the edge = the retest fill.
    let fillIdx: number | null = null;
    for (let k = r.end + 1; k <= last; k++) if (up ? bars[k].l <= edge : bars[k].h >= edge) { fillIdx = k; break; }
    if (fillIdx != null && fillIdx < last) return null;               // filled earlier — it's a live trade now, not a setup
    state = fillIdx === last ? "filled" : "armed";
    if (state === "filled") {
      const b = bars[last];
      const stopAt = up ? edge - DRIVER.STOP_TOL * tol : edge + DRIVER.STOP_TOL * tol;
      const vol = legVolRatio(pair, fv, bars.slice(r.start, r.end).map((x) => x.date), b.date);
      const low = vol == null ? null : vol <= DRIVER.RETEST_LOW_VOL;
      const held = up ? b.c > edge : b.c < edge;
      retest = { vol, low, held, confirmEntry: held && low === true && !(up ? b.l <= stopAt : b.h >= stopAt) };
    }
  } else {
    // Open range: surface it when price is pressing the reversal edge.
    // Pressing = the last close sits in the outer third of the band, or the last
    // bar's wick reached the edge zone.
    const pos = (bars[last].c - r.lo) / band;
    const touched = up ? bars[last].h >= edge - tol : bars[last].l <= edge + tol;
    if (!touched && (up ? pos < 1 - DRIVER.PRESS_FRAC : pos > DRIVER.PRESS_FRAC)) return null;
    state = "watch";
  }

  const t = at(si, bars[breakIdx ?? last].date);
  if (t < 0) return null;
  const loserLowDate = crackedAt(si, loser, t);
  const winnerCracking = crackedAt(si, winner, t) != null;
  const confirmed = loserLowDate != null && !winnerCracking;
  const barsLen = r.end - r.start;
  // Long ranges did slightly better (+0.43R vs +0.36R) — within the noise, so A/B is a
  // light sort order, not a verdict. The driver is deliberately NOT part of the grade.
  // A = the retest came in QUIET (futures volume). Fair-fill backtest, forex:
  // low-vol retest +0.34R (n=26, 2023–26) / +0.28R (n=47, 2021–26) vs +0.22 / +0.13
  // otherwise. Small samples — the same direction as futures & stocks (+0.48 vs +0.2).
  // The GRADE is COT (set in scanForexDrivers): trapped z≥1 = A, trapped = B, else skip.
  // The quiet retest stays on the card as information only.
  const grade: "A" | "B" = "B";
  const wyckoffRead = wyckoffReadFor(pair, bars, fv, r.start, r.status === "broken" ? r.end : n, up);
  const stopLoss = up ? edge - DRIVER.STOP_TOL * tol : edge + DRIVER.STOP_TOL * tol;
  const risk = Math.abs(edge - stopLoss);
  const barsSinceBreak = breakIdx == null ? null : last - breakIdx;

  const w = Math.max(0, t - 59);
  const rebase = (c: Ccy) => si.idx[c].slice(w, t + 1).map((v) => v - si.idx[c][w]);

  return {
    pair, side, state, grade, skip: "COT unavailable, no grade", wyckoffRead, cotPath: [],
    range: { start: bars[r.start].date, end: bars[Math.min(r.end, last)].date, lo: r.lo, hi: r.hi, bars: barsLen },   // open range: end = bars.length
    trendAtr,
    breakDate: breakIdx == null ? null : bars[breakIdx].date,
    barsSinceBreak,
    breakLevel,
    driver: { confirmed, loser, winner, loserLowDate, winnerCracking },
    order: {
      entry: edge,
      stopLoss,
      breakEven: up ? edge + risk : edge - risk,
      goodForBars: barsSinceBreak == null ? DRIVER.RETEST_BARS : DRIVER.RETEST_BARS - barsSinceBreak,
      manage: [
        "At +1R move the stop to break-even",
        "Then trail the stop 1R behind the best price",
        `Close it after ${DRIVER.MAX_HOLD} days if still open`,
      ],
    },
    checks: [
      { label: `prior trend ${up ? "down" : "up"} (60 days)`, pass: true, value: `${trendAtr.toFixed(1)} ATR` },
      { label: `range ≥ ${CFG.MINLEN} bars`, pass: true, value: `${barsLen} bars` },
      state === "watch"
        ? { label: `daily close ${up ? "above" : "below"} the break level`, pass: false, value: "not yet" }
        : { label: `broke ${up ? "up" : "down"} against the trend`, pass: true, value: bars[breakIdx!].date },
      { label: `${loser} cracking (20-day low on its index)`, pass: loserLowDate != null, value: loserLowDate ?? "no" },
      { label: `${winner} holding (no 20-day low)`, pass: !winnerCracking, value: winnerCracking ? "also weak" : "yes" },
    ],
    retest,
    positioning: null,                                                  // filled in by scanForexDrivers (needs the CFTC feed)
    strength: { dates: si.dates.slice(w, t + 1), loser: rebase(loser), winner: rebase(winner) },
    bars: bars.slice(Math.max(0, Math.min(r.start - 15, n - 120), n - 200))
      .map((b) => [b.o, b.h, b.l, b.c, b.date] as [number, number, number, number, string]),
    lastBarDate: bars[last].date,
  };
}

export function findDriverSetups(pairs: Record<string, Bar[]>, fv?: FutVol): DriverSetup[] {
  const si = strengthIndex(pairs);
  const out: DriverSetup[] = [];
  for (const p of PAIRS) { const b = pairs[p]; if (b?.length) { const s = driverSetupFor(p, b, si, fv); if (s) out.push(s); } }
  const rank = { filled: 0, armed: 1, watch: 2 } as const;
  return out.sort((a, b) => rank[a.state] - rank[b.state] || a.grade.localeCompare(b.grade));
}

// ── Fetch + cache ─────────────────────────────────────────────────────────────
// Own fetcher on purpose: lib/wyckoff/daily.ts drops zero-volume bars (spot FX is
// all zero-volume) and Yahoo's daily FX close is stale. We pull 1h bars and build
// the daily candle ourselves: session 17:00 → 17:00 New York (DST-safe via Intl).
const nyParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});
/** The FX session date a UTC timestamp belongs to: NY time + 7h, so 17:00 NY rolls to the next day. */
function nyHour(tsSec: number): number {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(tsSec * 1000)).map((x) => [x.type, x.value]));
  return +p.hour % 24;
}

function sessionDate(tsSec: number): string {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(tsSec * 1000)).map((x) => [x.type, x.value]));
  const ny = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour);          // NY wall clock, as if UTC
  return new Date(ny + 7 * 3600_000).toISOString().slice(0, 10);
}

export async function fetchSpot(pair: string): Promise<Bar[]> {
  const { data } = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${pair}=X`, {
    params: { interval: "1h", range: "730d" },                          // Yahoo's hourly limit ≈ 2y
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    timeout: 30_000,
  });
  const res = data?.chart?.result?.[0];
  if (!res?.timestamp?.length) throw new Error(`Yahoo ${pair}=X: empty response`);
  const q = res.indicators.quote[0];
  const days = new Map<string, Bar & { n: number; lastHour: boolean }>();
  for (let i = 0; i < res.timestamp.length; i++) {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if (![o, h, l, c].every((x) => typeof x === "number" && Number.isFinite(x))) continue;
    const date = sessionDate(res.timestamp[i]);
    const isLast = nyHour(res.timestamp[i]) === 16;                     // the 16:00–17:00 NY bar = the close
    const d = days.get(date);
    if (!d) days.set(date, { o, h, l, c, v: 0, date, n: 1, lastHour: isLast });
    else { d.h = Math.max(d.h, h); d.l = Math.min(d.l, l); d.c = c; d.n++; d.lastHour ||= isLast; }
  }
  const today = sessionDate(Date.now() / 1000);                        // the session still trading
  const done = [...days.values()]
    .filter((d) => d.date < today && d.n >= 12 && new Date(d.date + "T12:00:00Z").getUTCDay() % 6 !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  // The newest day only counts once Yahoo has delivered its final hour — otherwise
  // its close would be the 15:00 price. Older days are left alone (a rare missing
  // hour in history mustn't shift the ranges).
  if (done.length && !done[done.length - 1].lastHour) done.pop();
  return done.map(({ n: _n, lastHour: _l, ...b }) => b);
}

/** Trusted daily volume of the 7 currency futures (real summed-contract totals where
 *  stored, roll garbage dropped). Best-effort per leg. */
export async function futuresLegVolume(legs: Ccy[] = Object.keys(FUT) as Ccy[]): Promise<FutVol> {
  const fv: FutVol = {};
  await Promise.all(legs.filter((c) => FUT[c]).map(async (c) => {
    const f = FUT[c]!;
    try {
      const raw = await fetchDailyBars(`${f}=F`, "2y");
      let bars = raw;
      try { bars = patchVolume(raw, await storedVolume(f)).bars; } catch { /* keep Yahoo's */ }
      const mask = rollMask(bars);
      fv[c] = new Map(bars.filter((_, i) => !mask[i]).map((b) => [b.date, b.v]));
    } catch { /* leg skipped */ }
  }));
  return fv;
}

/** Bars for the expanded forex chart: NY-close candles, with v = the currency
 *  futures' volume for the pair's non-USD legs (summed for crosses; 0 where unreadable). */
export async function forexChartBars(pair: string): Promise<{ bars: Bar[]; legs: string[] }> {
  if (!PAIRS.includes(pair)) throw new Error(`unknown pair ${pair}`);
  const legs = [pair.slice(0, 3), pair.slice(3)].filter((c) => FUT[c as Ccy]) as Ccy[];
  const [spot, fv] = await Promise.all([fetchSpot(pair), futuresLegVolume(legs)]);
  const bars = spot.map((b) => ({ ...b, v: legs.reduce((t, c) => t + (fv[c]?.get(b.date) ?? 0), 0) }));
  return { bars, legs: legs.map((c) => FUT[c]!) };
}

export interface DriverScan { at: string; setups: DriverSetup[]; abcd?: AbcdSetup[]; alerts: CurrencyAlert[]; lastBarDate: string | null; errors: { pair: string; error: string }[]; cotError?: string | null }
let cache: { at: number; scan: DriverScan } | null = null;
const TTL_MS = 15 * 60 * 1000;

export async function scanForexDrivers(force = false): Promise<DriverScan> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.scan;
  const pairs: Record<string, Bar[]> = {};
  const errors: DriverScan["errors"] = [];
  for (let i = 0; i < PAIRS.length; i += 7) {
    await Promise.all(PAIRS.slice(i, i + 7).map(async (p) => {
      try { pairs[p] = await fetchSpot(p); } catch (e) { errors.push({ pair: p, error: e instanceof Error ? e.message : String(e) }); }
    }));
  }
  // The strength index needs all 28 — one missing pair would silently skew every currency.
  if (errors.length) {
    const scan = { at: new Date().toISOString(), setups: [], alerts: [], lastBarDate: null, errors };
    return scan;                                                        // don't cache a broken scan
  }
  // Currency futures volume for the retest read. Best-effort: without it the
  // retest shows "volume unavailable" and nothing is graded A.
  const fv = await futuresLegVolume();
  const setups = findDriverSetups(pairs, fv);
  // AB=CD (paper only): same bars, no extra fetch.
  const abcd = PAIRS.map((p) => (pairs[p]?.length ? abcdFor(p, pairs[p]) : null)).filter((x): x is AbcdSetup => !!x);
  let cotError: string | null = null;
  // Real-money positioning over each range (weekly CFTC). Best-effort: without it
  // the card just shows no positioning line.
  try {
    const cot = await fetchCot();
    for (const s of setups) {
      const B = s.pair.slice(0, 3), Q = s.pair.slice(3);
      const [buy, sell] = s.side === "long" ? [B, Q] : [Q, B];
      // Frozen at the break (tested that way); a "watch" setup reads up to today.
      s.positioning = positioningRead(cot, buy, sell, s.range.start, s.breakDate ?? s.lastBarDate);
      const z = s.positioning.sell.z, v = s.positioning.sell.verdict;
      if (sell === "USD") s.skip = "selling USD: no COT edge (tested −0.19R / −0.23R, rarely runs)";
      else if (v === "trapped" && z != null && z >= 1) { s.grade = "A"; s.skip = null; }
      // A-only on forex: B (trapped z 0.5–1) tested −0.49R / +0.15R, and no better when the path moved.
      else if (v === "trapped") s.skip = `COT only mildly trapped in ${sell} (z ${z?.toFixed(2)}): A-only, B tested −0.49R / +0.15R`;
      else s.skip = v === "late" ? `COT late: real money already selling ${sell}`
        : v === "flat" ? `COT quiet: real money not trapped in ${sell}`
        : `no COT history for ${sell}`;
      // After the break: re-check every new report. Tested (2021–26): still trapped at the
      // retest +0.63R / +0.25R; turned flat before the fill −0.73R / −0.48R (7 of 10 full
      // stops). The grade only ever goes DOWN — the one B → A lost.
      if (!s.skip && s.breakDate) {
        // "filled" = filled on the last bar → judge on the evening before, as tested
        const until = s.state === "filled" ? (s.bars.at(-2)?.[4] ?? s.lastBarDate) : s.lastBarDate;
        s.cotPath = cotPathFor(cot, buy, sell, s.range.start, s.breakDate, until);
        const now = s.cotPath[s.cotPath.length - 1];
        if (now.state === "flat" || now.state === "late" || now.state === "n/a")
          s.skip = `COT no longer trapped: real money turned on ${sell} since the break (${now.at}). Cancel the limit (tested −0.73R / −0.48R)`;
        else if (now.state === "B") s.skip = `COT eased to B since the break (${now.at}): A-only, cancel the limit`;
      }
    }
    // AB=CD: COT attached for information only (it flipped between periods on this pattern).
    for (const a of abcd) {
      const B = a.pair.slice(0, 3), Q = a.pair.slice(3);
      const [buy, sell] = a.side === "long" ? [B, Q] : [Q, B];
      a.positioning = positioningRead(cot, buy, sell, a.b.date, a.lastBarDate);
    }
  } catch (e) { cotError = e instanceof Error ? e.message : String(e); }
  abcd.sort((x, y) => (x.state === "filled" ? 0 : 1) - (y.state === "filled" ? 0 : 1) || x.barsLeft - y.barsLeft);
  const rank = { filled: 0, armed: 1, watch: 2 } as const;
  setups.sort((a, b) => Number(!!a.skip) - Number(!!b.skip) || rank[a.state] - rank[b.state] || a.grade.localeCompare(b.grade));
  const alerts = currencyAlerts(strengthIndex(pairs));
  const scan = { at: new Date().toISOString(), setups, abcd, alerts, lastBarDate: pairs.EURUSD?.at(-1)?.date ?? null, errors, cotError };
  cache = { at: Date.now(), scan };
  return scan;
}
