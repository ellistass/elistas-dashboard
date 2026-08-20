// lib/chart/volume.ts — read volume as EFFORT, not as bar height.
//
// Ported from the Wyckoff forward-play trainer, where this treatment is the
// reason the tape is legible. Four ideas, in order of how much they matter:
//
// 1. A 20-bar volume MA. Without a reference line, "big volume" gets judged
//    against whatever the tallest bar on screen happens to be — which changes
//    every time the window scrolls.
//
// 2. Bars shaded by their RATIO to that line, not by absolute height. Colour
//    keeps carrying direction; opacity carries effort. A genuinely large print
//    lights up against a dim tape and a dormant stretch recedes, so supply and
//    demand imbalance is readable without measuring anything.
//
// 3. A clipped scale. One climax bar must not squash the other ninety into
//    stubs. Clipped bars get a cap mark so a shortened bar is never presented
//    as if it were the whole story.
//
// 4. Effort vs result per bar — heavy volume with a narrow spread is ABSORB
//    (someone eating the flow); heavy volume with a wide spread is CLIMAX.
//
// Everything here uses only bars at index <= k, so it is safe on a progressive
// reveal: nothing can look ahead.

export interface VolBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const VOL_MA_N = 20;

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Trailing volume mean at every index. Value at k uses bars [k-n+1 .. k],
 *  never anything later — this is what makes it replay-safe. */
export function volMA(bars: VolBar[], n = VOL_MA_N): number[] {
  const out: number[] = [];
  for (let k = 0; k < bars.length; k++) {
    const a = Math.max(0, k - n + 1);
    out.push(mean(bars.slice(a, k + 1).map((b) => b.v)));
  }
  return out;
}

/**
 * Volume-pane ceiling.
 *
 * max(median x 5, p90 x 1.55), never above the true max. On a normal tape this
 * lands just above the busy bars; when one session prints ten times normal it
 * clips that bar instead of flattening everything else into noise.
 */
export function volScale(bars: VolBar[]): { maxV: number; clipped: (v: number) => boolean } {
  if (!bars.length) return { maxV: 1, clipped: () => false };
  const sorted = bars.map((b) => b.v).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 1;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || med;
  const trueMax = sorted[sorted.length - 1] || 1;
  const maxV = Math.max(1, Math.min(trueMax, Math.max(med * 5, p90 * 1.55)));
  return { maxV, clipped: (v: number) => v > maxV };
}

/** Opacity from the ratio to the moving average. The steps are deliberately
 *  coarse — four legible states beat a smooth gradient nobody can read. */
export function volAlpha(v: number, ma: number): number {
  const rel = ma > 0 ? v / ma : 1;
  if (rel >= 1.8) return 0.95; // heavy effort — glows
  if (rel >= 1.2) return 0.6;
  if (rel <= 0.7) return 0.18; // dormant — nearly vanishes
  return 0.3;
}

export type EffortTag = "ABSORB" | "CLIMAX" | "NO-OPP" | "QUIET" | null;

export interface BarEffort {
  /** Volume as a multiple of the trailing average. */
  vr: number;
  /** Spread as a multiple of the trailing average spread. */
  sr: number;
  /** Close position within the bar's range, 0 = low, 1 = high. */
  cp: number;
  tag: EffortTag;
  desc: string;
}

/**
 * Effort vs result for one bar, against its own trailing window.
 *
 * Needs at least 5 prior bars — scoring a bar against two predecessors would
 * produce confident-looking nonsense at the left edge of every chart.
 */
export function barER(bars: VolBar[], k: number, n = VOL_MA_N): BarEffort | null {
  const b = bars[k];
  if (!b) return null;
  const win = bars.slice(Math.max(0, k - n), k);
  if (win.length < 5) return null;

  const avgV = mean(win.map((x) => x.v));
  const avgS = mean(win.map((x) => x.h - x.l));
  const spread = b.h - b.l;
  const vr = avgV > 0 ? b.v / avgV : 1;
  const sr = avgS > 0 ? spread / avgS : 1;
  const cp = spread > 0 ? (b.c - b.l) / spread : 0.5;

  let tag: EffortTag = null;
  let desc = "";
  if (vr >= 1.8 && sr <= 0.85) {
    tag = "ABSORB";
    desc = "heavy effort, no result — someone is absorbing";
  } else if (vr >= 1.8 && sr >= 1.3) {
    tag = "CLIMAX";
    desc = "heavy effort, wide result — climactic action";
  } else if (vr <= 0.7 && sr >= 1.3) {
    tag = "NO-OPP";
    desc = "light effort, wide result — no opposition";
  } else if (vr <= 0.7 && sr <= 0.85) {
    tag = "QUIET";
    desc = "light effort, light result — dormant";
  }
  return { vr, sr, cp, tag, desc };
}

/** Only these two are worth a mark on the chart. NO-OPP and QUIET are useful
 *  in a tooltip but plotting four symbols turns the pane into confetti. */
export const isPlottableTag = (t: EffortTag) => t === "ABSORB" || t === "CLIMAX";

/**
 * Everything a volume pane needs, computed once.
 *
 * `trusted: false` is the honest path for instruments whose feed we do not
 * believe (Yahoo volume on 6C/6J/6S, most futures-as-CFD). Brightening a bar
 * READS as information — doing it on a feed we have publicly called unreliable
 * would be a lie told confidently. So the caller renders those flat and grey,
 * with the MA and the effort dots suppressed entirely.
 */
export function volumeView(bars: VolBar[], opts?: { trusted?: boolean; ma?: number }) {
  const trusted = opts?.trusted !== false;
  const n = opts?.ma ?? VOL_MA_N;
  const ma = volMA(bars, n);
  const { maxV, clipped } = volScale(bars);
  return {
    trusted,
    ma,
    maxV,
    clipped,
    maN: n,
    alphaAt: (k: number) => (trusted ? volAlpha(bars[k]?.v ?? 0, ma[k] ?? 0) : 0.3),
    effortAt: (k: number) => (trusted ? barER(bars, k, n) : null),
  };
}
