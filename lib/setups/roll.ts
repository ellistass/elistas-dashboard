// lib/setups/roll.ts — spot bad volume from futures contract rolls.
//
// Yahoo's continuous futures (6A=F, ES=F, …) keep printing the EXPIRING
// contract for several days after the market has moved to the next one.
// Seen on 6A=F / 6E=F, 14–23 Sep 2026: 17–138 contracts a day where the real
// (December) volume was 60,000–230,000. Any volume rule reading those bars
// sees "no effort" or a "quiet retest" that never happened.
//
// This flags bars whose volume can't be trusted:
//   • collapsed: under 10% of the median of the previous 20 good bars
//   • duplicated: exactly the same volume as the previous bar (a Yahoo repeat)
// Averages are then taken over good bars only, and a rule whose deciding bar
// is flagged reports "volume unavailable" instead of guessing.

import type { Bar } from "@/lib/wyckoff/engine";

export function rollMask(bars: Bar[]): boolean[] {
  const bad: boolean[] = new Array(bars.length).fill(false);
  const good: number[] = [];                       // rolling window of trusted volumes
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i].v;
    const dup = i > 0 && v === bars[i - 1].v && v > 1;
    let collapsed = false;
    if (good.length >= 10) {
      const w = good.slice(-20).sort((a, b) => a - b);
      collapsed = v < 0.1 * w[w.length >> 1];
    }
    bad[i] = dup || collapsed;
    if (!bad[i]) good.push(v);
  }
  return bad;
}

/** Average volume over [from, to), skipping flagged bars. NaN if too few good bars. */
export function goodAvgVolume(bars: Bar[], mask: boolean[], from: number, to: number, minGood = 5): number {
  let s = 0, n = 0;
  for (let i = Math.max(0, from); i < to; i++) if (!mask[i]) { s += bars[i].v; n++; }
  return n >= minGood ? s / n : NaN;
}
