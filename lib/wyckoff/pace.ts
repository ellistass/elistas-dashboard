// lib/wyckoff/pace.ts — effort and result measured in TIME instead of volume.
//
// THE IDEA
// The engine's verdict is volume per point of travel: going up expensive
// relative to going down means supply is present. That reading needs
// trustworthy volume — and roughly half this basket does not have it. Every
// commodity, every non-US index and 6C/6J/6S are all SUSPECT_VOLUME, so on
// those instruments the engine is grading noise.
//
// Pace asks the same question with the one input that is never broken: time.
//
//     engine:  (upVolume / upTravel) / (downVolume / downTravel)
//     pace:    (upBars   / upTravel) / (downBars   / downTravel)
//
// Same shape, different numerator. A market that grinds upward over many bars
// and drops in a few is spending more TIME per point of advance than per point
// of decline — the signature of supply meeting every rally. The reverse is
// demand absorbing every dip.
//
// This is a second opinion precisely where the first one cannot be trusted.
//
// ── BLIND INTEGRITY ────────────────────────────────────────────────────────
// `lean` is a DIRECTIONAL inference. It is computed only from bars already
// visible — no lookahead — but a surface that prints "supply" next to a live
// unresolved candidate is handing the trader a verdict, which is the one thing
// the blind architecture exists to prevent.
//
// Rule: live surfaces render the NUMBERS only. `lean` belongs to review,
// practice and resolved cases. The module returns both; the caller decides.

import type { Bar } from "./engine";

export interface PaceRead {
  /** Bars spent per unit of upward travel. Higher = slower, grindier advances. */
  upBarsPerUnit: number | null;
  /** Bars spent per unit of downward travel. */
  dnBarsPerUnit: number | null;
  /** upBarsPerUnit / dnBarsPerUnit. >1 = advances are the slow side. */
  ratio: number | null;
  /** Mean high-low spread of up-closing vs down-closing bars. */
  avgUpSpread: number | null;
  avgDnSpread: number | null;
  /** avgDnSpread / avgUpSpread. >1 = declines arrive in wider bars. */
  spreadRatio: number | null;
  upBars: number;
  dnBars: number;
  /** Directional inference — NOT for live unresolved surfaces. */
  lean: "supply" | "demand" | "balanced" | null;
}

// Deliberately wider than the engine's 1.12 / 0.89. Those were tuned against
// volume over a real sample; these are not tuned against anything yet, so the
// neutral band is generous on purpose — a metric with no track record should
// stay quiet unless the asymmetry is obvious.
export const PACE_SUPPLY = 1.2;
export const PACE_DEMAND = 0.83;

export function paceRead(bars: Bar[], start: number, end: number): PaceRead {
  const seg = bars.slice(start, end);
  const empty: PaceRead = {
    upBarsPerUnit: null, dnBarsPerUnit: null, ratio: null,
    avgUpSpread: null, avgDnSpread: null, spreadRatio: null,
    upBars: 0, dnBars: 0, lean: null,
  };
  if (seg.length < 5) return empty;

  let upBars = 0, upTravel = 0, upSpread = 0;
  let dnBars = 0, dnTravel = 0, dnSpread = 0;

  for (let k = 1; k < seg.length; k++) {
    const d = seg[k].c - seg[k - 1].c;
    const spread = seg[k].h - seg[k].l;
    if (d > 0) {
      upBars++; upTravel += d; upSpread += spread;
    } else if (d < 0) {
      dnBars++; dnTravel += -d; dnSpread += spread;
    }
    // Unchanged closes belong to neither side. Counting them would inflate
    // whichever side happened to be quieter.
  }

  if (upTravel <= 0 || dnTravel <= 0 || upBars === 0 || dnBars === 0) return empty;

  const upBarsPerUnit = upBars / upTravel;
  const dnBarsPerUnit = dnBars / dnTravel;
  const ratio = upBarsPerUnit / dnBarsPerUnit;
  const avgUpSpread = upSpread / upBars;
  const avgDnSpread = dnSpread / dnBars;

  return {
    upBarsPerUnit: r6(upBarsPerUnit),
    dnBarsPerUnit: r6(dnBarsPerUnit),
    ratio: Number(ratio.toFixed(3)),
    avgUpSpread: r6(avgUpSpread),
    avgDnSpread: r6(avgDnSpread),
    spreadRatio: avgUpSpread > 0 ? Number((avgDnSpread / avgUpSpread).toFixed(3)) : null,
    upBars,
    dnBars,
    lean: ratio >= PACE_SUPPLY ? "supply" : ratio <= PACE_DEMAND ? "demand" : "balanced",
  };
}

const r6 = (v: number) => Number(v.toPrecision(6));

/** Plain-language description of the numbers, without naming a direction.
 *  Safe to show anywhere, including on a live unresolved candidate. */
export function describePace(p: PaceRead): string | null {
  if (p.ratio == null) return null;
  const pct = Math.abs(1 - p.ratio) * 100;
  if (pct < 8) return "advances and declines travel at a similar pace";
  const slow = p.ratio > 1 ? "advances" : "declines";
  return `${slow} take ${pct.toFixed(0)}% more time per point`;
}

/** Does the pace read agree with a volume-based verdict? Disagreement is the
 *  interesting case — worth surfacing in review, especially on instruments
 *  where the volume feed is untrustworthy and pace is the better witness. */
export function paceAgreesWith(p: PaceRead, engineVerdict: string | null | undefined): boolean | null {
  if (!p.lean || !engineVerdict) return null;
  if (engineVerdict === "neutral") return p.lean === "balanced";
  if (engineVerdict === "distrib") return p.lean === "supply";
  if (engineVerdict === "accum") return p.lean === "demand";
  return null;
}
