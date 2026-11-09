// lib/setups/layers.ts — the Nov 2026 market-condition layers on grade-A range setups.
//
// Tested 9 Nov 2026: grade A + 50k account rules, 2018 – Oct 2026, every layer together:
//   209 trades, 62% win, +0.74R/trade, +155R, max DD −7.8R, still +0.47R/trade with the win
//   rate cut 10 points. Stocks 63%, commodities 62%, forex 61%, index futures 60%.
// Each layer is a RULE (card shows "rule: skip", gate blocks it); the grade letter is unchanged.
// Thresholds were chosen on the same data — expect live results a few points lower.

import type { Bar } from "@/lib/wyckoff/engine";
import type { Side } from "./rules";

export interface LayerRead {
  /** Shown on the card as checks. */
  checks: { label: string; pass: boolean; value?: string }[];
  /** First failed rule, or null. */
  skip: string | null;
}

const before = (bars: Bar[], date: string) => {
  let i = bars.length - 1;
  while (i >= 0 && bars[i].date >= date) i--;
  return i;                                   // last bar BEFORE the signal day
};
const smaAt = (bars: Bar[], i: number, n: number) => {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += bars[k].c;
  return s / n;
};

// ── Stocks ───────────────────────────────────────────────────────────────────
// Own 200-day trend: longs only when the stock's 200-day is rising (vs 20 bars ago),
// shorts only when falling. Inside a healthy market: 58% / +0.69R aligned vs 47% / +0.09R
// against (basket); 19 new stocks +0.31R vs +0.14R (same win rate — smaller edge there).
// Engine read against the trade (distribution on a long, accumulation on a short): skip.
// Basket 63% / +1.02R without them vs 50% / +0.10R; 19 new stocks 62% vs 52%.
export function stockLayers(bars: Bar[], side: Side, signalDate: string, engineAgrees: boolean | null, verdict: string): LayerRead {
  const checks: LayerRead["checks"] = [];
  let skip: string | null = null;
  const i = before(bars, signalDate);
  const now = smaAt(bars, i, 200), then = smaAt(bars, i - 20, 200);
  if (now != null && then != null) {
    const rising = now > then;
    const ok = side === "long" ? rising : !rising;
    checks.push({
      label: "Stock's own 200-day with the trade: rising for longs, falling for shorts (rule — skip if not)",
      pass: ok, value: `200-day ${rising ? "rising" : "falling"}`,
    });
    if (!ok) skip = `stock's own 200-day ${rising ? "rising" : "falling"} — ${side === "long" ? "longs" : "shorts"} only with it`;
  }
  const engineOk = engineAgrees !== false;
  checks.push({
    label: "Engine read not against the trade (rule — skip if against)",
    pass: engineOk, value: verdict,
  });
  if (!engineOk) skip ??= `engine read ${verdict} — against the ${side}`;
  return { checks, skip };
}

// ── Index futures ────────────────────────────────────────────────────────────
// Range AVWAP centred (0.4–0.6 of the band) AND price held on our side of the swing
// AVWAP for the last 10 closes. Grade A index trades: 47 trades, 60% win, +0.92R
// (halves +0.80 / +0.98) vs 49% / +0.77R with the 6-month value-area skip.
const avwap = (bars: Bar[], from: number, to: number) => {
  let pv = 0, v = 0;
  for (let k = from; k <= to; k++) { const tp = (bars[k].h + bars[k].l + bars[k].c) / 3; pv += tp * bars[k].v; v += bars[k].v; }
  return v > 0 ? pv / v : null;
};

export function indexLayers(bars: Bar[], side: Side, rangeStart: string, rangeLo: number, rangeHi: number, signalDate: string): LayerRead {
  const checks: LayerRead["checks"] = [];
  const long = side === "long", band = rangeHi - rangeLo;
  const a = bars.findIndex((b) => b.date >= rangeStart);
  const e = bars.findIndex((b) => b.date >= signalDate);
  if (a < 0 || e < 0 || !(band > 0)) return { checks, skip: null };
  // Range AVWAP position: 0 = at the stop-side edge, 1 = at the edge we trade toward.
  const av = avwap(bars, a, e);
  const pos = av == null ? null : long ? (av - rangeLo) / band : (rangeHi - av) / band;
  const centred = pos != null && pos >= 0.4 && pos <= 0.6;
  checks.push({ label: "Range AVWAP centred, 0.4–0.6 of the range (rule)", pass: centred, value: pos == null ? "no volume" : pos.toFixed(2) });
  // Swing AVWAP: anchored at the swing low (longs) / high (shorts) of the 60 bars before the signal.
  const s0 = Math.max(0, e - 60);
  let anchor = s0;
  for (let k = s0; k < e; k++) if (long ? bars[k].l < bars[anchor].l : bars[k].h > bars[anchor].h) anchor = k;
  let held = false;
  if (e - 9 >= anchor) {
    held = true;
    for (let k = e - 9; k <= e; k++) {
      const sw = avwap(bars, anchor, k);
      if (sw == null || (long ? bars[k].c < sw : bars[k].c > sw)) { held = false; break; }
    }
  }
  checks.push({ label: "Held on our side of the swing AVWAP for the last 10 closes (rule)", pass: held });
  const ok = centred && held;
  return { checks, skip: ok ? null : `index AVWAP ${centred ? "centred" : "off-centre"}, swing AVWAP ${held ? "held" : "not held"} — index trades need both` };
}

// ── Commodities (incl. grains/softs) ─────────────────────────────────────────
// 6-month (120 sessions) volume profile: skip when the signal close sits INSIDE the
// value area (70% of volume) — balanced market. Beyond value = trending your way.
export function valueArea(bars: Bar[], signalDate: string, sessions = 120, bins = 50) {
  const e = bars.findIndex((b) => b.date >= signalDate);
  if (e < sessions) return null;
  const win = bars.slice(e - sessions + 1, e + 1);
  const lo = Math.min(...win.map((b) => b.l)), hi = Math.max(...win.map((b) => b.h));
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins, vol = new Array(bins).fill(0);
  for (const b of win) {
    const j0 = Math.min(bins - 1, Math.floor((b.l - lo) / step)), j1 = Math.min(bins - 1, Math.floor((b.h - lo) / step));
    for (let j = j0; j <= j1; j++) vol[j] += b.v / (j1 - j0 + 1);
  }
  const total = vol.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return null;
  let poc = 0; for (let j = 1; j < bins; j++) if (vol[j] > vol[poc]) poc = j;
  let a = poc, z = poc, inVa = vol[poc];
  while (inVa < 0.7 * total && (a > 0 || z < bins - 1)) {
    const down = a > 0 ? vol[a - 1] : -1, up = z < bins - 1 ? vol[z + 1] : -1;
    if (up >= down) inVa += vol[++z]; else inVa += vol[--a];
  }
  const val = lo + a * step, vah = lo + (z + 1) * step, close = bars[e].c;
  return { val, vah, poc: lo + (poc + 0.5) * step, close, where: close > vah ? "above" : close < val ? "below" : "inside" } as const;
}

const GRAINS = new Set(["ZC", "ZW", "ZS"]);
const NO_RANGE = new Set(["PL", "PA", "NG"]);

export interface RealYieldRead { change: number; supporting: number }

/** US 10y real yield (FRED DFII10) change over the 60 sessions before the signal. */
export function realYieldRead(series: [string, number][], side: Side, signalDate: string): RealYieldRead | null {
  let i = series.length - 1;
  while (i >= 0 && series[i][0] >= signalDate) i--;
  if (i < 60) return null;
  const change = +(series[i][1] - series[i - 60][1]).toFixed(2);
  // Falling real yields support gold/silver longs; rising support shorts.
  return { change, supporting: +((side === "long" ? -change : change)).toFixed(2) };
}

export function commodityLayers(bars: Bar[], instrument: string, side: Side, signalDate: string, realYield: [string, number][] | null): LayerRead {
  const checks: LayerRead["checks"] = [];
  let skip: string | null = null;
  // Platinum, palladium, natural gas: range setups lost in every split (30–34% win).
  if (NO_RANGE.has(instrument)) {
    checks.push({ label: "Market traded with range setups (platinum, palladium, natural gas: no)", pass: false });
    skip = `${instrument}: no range setups (2018–26: 30–34% win, every split negative)`;
  }
  // Grain shorts: 0 for 6 on grade A, negative overall.
  if (GRAINS.has(instrument) && side === "short") {
    checks.push({ label: "Grains: longs only (rule)", pass: false });
    skip ??= "grain shorts — skip (grade A 0 for 6)";
  }
  // Gold/silver: take only when US real yields moved AGAINST the trade by ≥ 0.10 over 3 months.
  // Gold+silver: against 57% / +0.25R (n 28) vs with −0.39R; both halves, both sides.
  if ((instrument === "GC" || instrument === "SI") && realYield) {
    const r = realYieldRead(realYield, side, signalDate);
    if (r) {
      const ok = r.supporting <= -0.1;
      checks.push({
        label: "US real yields moved against the trade by ≥ 0.10 over 3 months (rule — range likely to hold)",
        pass: ok, value: `10y real yield ${r.change >= 0 ? "+" : ""}${r.change} pts`,
      });
      if (!ok) skip ??= `real yields ${r.supporting > 0 ? "with" : "flat vs"} the trade — gold/silver range likely to break`;
    }
  }
  const va = valueArea(bars, signalDate);
  if (va) {
    const ok = va.where !== "inside";
    checks.push({
      label: "6-month value area: price beyond value, not inside it (rule — skip if inside)",
      pass: ok, value: `${va.where} · value ${va.val.toPrecision(5)}–${va.vah.toPrecision(5)}`,
    });
    if (!ok) skip ??= "inside the 6-month value area — balanced market";
  }
  return { checks, skip };
}
