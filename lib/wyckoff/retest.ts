// lib/wyckoff/retest.ts — is this retest an LPS, or a breakout being sold?
//
// The conservative entry prices the retest of a broken boundary, which is the
// back-up / LPS idea by geometry. Geometry alone cannot tell the two apart:
//
//   LPS      price returns to the old edge and supply DOES NOT SHOW UP.
//            Narrow spread, volume drying up, the level holds. The absence of
//            effort against the move is the whole signal.
//   Failure  price returns to the old edge on RISING volume and wide bars.
//            Sellers are there. This is the breakout being sold into.
//
// Identical on a price chart. Opposite in meaning. The card was pricing both
// the same way and calling both "conservative".
//
// WFC is the worked example. It pushed above its box on 2026-09-04 at 0.56x
// the range's average volume — half the effort of a normal day — and closed
// back inside the next session. There was never a Sign of Strength, so there
// was never an LPS to wait for. Grading the push would have said so at the
// time; pricing it did not.
//
// Two events, scored separately, because they answer different questions:
//   SOS/SOW — did the break have effort behind it?  (volume UP, spread WIDE)
//   LPS/LPSY — did the pullback lack effort?        (volume DOWN, spread NARROW)
//
// Thresholds are a starting point, not a finding. Measured across 227 resolved
// breaks, confirmed and unconfirmed sequences showed no difference in direction
// — which is expected, since an LPS is an entry-quality tool rather than a
// direction predictor. Tune these against your own reads, not against outcome.

import type { Bar } from "./engine";
import { CFG } from "./engine";

/** A break needs volume at least this multiple of the range average to count
 *  as effort. 1.0 would be "an ordinary day", which proves nothing. */
export const SOS_VOLUME = 1.3;
/** ...and a bar at least this much wider than the range's average bar. */
export const SOS_SPREAD = 1.2;
/** A pullback must be at most this fraction of average volume to count as
 *  supply being absent. */
export const LPS_VOLUME = 0.85;
/** ...on a bar no wider than this multiple of the range's average. */
export const LPS_SPREAD = 1.1;

export type RetestVerdict = "lps" | "no-test-yet" | "no-effort-break" | "supply-present";

export interface RetestGrade {
  verdict: RetestVerdict;
  /** Short label for the card. */
  label: string;
  /** One line saying what was actually observed. */
  detail: string;
  /** True only when the sequence is complete and clean. */
  confirmed: boolean;
  /** True when the evidence argues AGAINST taking the retest. */
  warning: boolean;
  /** The measured numbers, so the card can show its working. */
  breakVolumeX: number | null;
  breakSpreadX: number | null;
  retestVolumeX: number | null;
  retestSpreadX: number | null;
}

export interface RetestInput {
  bars: Bar[];
  /** Index of the first bar of the range. */
  start: number;
  /** Index of the breakout bar (first bar AFTER the range). */
  end: number;
  rangeLo: number;
  rangeHi: number;
  /** Which way it broke. */
  up: boolean;
}

const none = (verdict: RetestVerdict, label: string, detail: string, warning = false): RetestGrade => ({
  verdict, label, detail, confirmed: false, warning,
  breakVolumeX: null, breakSpreadX: null, retestVolumeX: null, retestSpreadX: null,
});

/**
 * Grade the break and the pullback that followed it.
 *
 * Everything is measured against the RANGE'S OWN average volume and spread.
 * Absolute volume says nothing — 8M shares is heavy for one instrument and
 * quiet for another, and heavy for one range and normal for the next.
 */
export function gradeRetest(input: RetestInput): RetestGrade {
  const { bars, start, end, rangeLo, rangeHi, up } = input;
  const inRange = bars.slice(start, end);
  if (inRange.length < 5) return none("no-test-yet", "range too short", "not enough bars in the range to set a baseline");

  const avgV = inRange.reduce((s, b) => s + b.v, 0) / inRange.length;
  const avgS = inRange.reduce((s, b) => s + (b.h - b.l), 0) / inRange.length;
  if (!(avgV > 0) || !(avgS > 0)) return none("no-test-yet", "no baseline", "the range has no usable volume or spread");

  const tol = (rangeHi - rangeLo) * CFG.TOL_FRAC;
  const after = bars.slice(end, Math.min(end + 20, bars.length));
  if (!after.length) return none("no-test-yet", "no bars yet", "the range has not broken out yet");

  // ── The break: effort in the direction of travel ───────────────────────────
  // Within three bars, because a Sign of Strength that takes a fortnight to
  // appear is not the same event.
  let sosIdx = -1;
  for (let i = 0; i < Math.min(3, after.length); i++) {
    const b = after[i];
    const carried = up ? b.c > rangeHi : b.c < rangeLo;
    if (carried && b.v >= avgV * SOS_VOLUME && (b.h - b.l) >= avgS * SOS_SPREAD) { sosIdx = i; break; }
  }

  const first = after[0];
  const bV = first.v / avgV;
  const bS = (first.h - first.l) / avgS;

  if (sosIdx < 0) {
    return {
      verdict: "no-effort-break",
      label: up ? "no sign of strength" : "no sign of weakness",
      detail:
        `The break carried ${bV.toFixed(2)}x the range's average volume on a ${bS.toFixed(2)}x bar. ` +
        `A genuine ${up ? "SOS" : "SOW"} needs effort behind it — without one there is no ${up ? "LPS" : "LPSY"} to wait for, ` +
        `and the retest is just price coming back.`,
      confirmed: false,
      warning: true,
      breakVolumeX: bV, breakSpreadX: bS, retestVolumeX: null, retestSpreadX: null,
    };
  }

  const sos = after[sosIdx];
  const sV = sos.v / avgV;
  const sS = (sos.h - sos.l) / avgS;

  // ── The pullback: the ABSENCE of effort against it ─────────────────────────
  for (let i = sosIdx + 1; i < after.length; i++) {
    const b = after[i];
    const returned = up ? b.l <= rangeHi + tol : b.h >= rangeLo - tol;
    if (!returned) continue;                       // hasn't come back yet

    const held = up ? b.c > rangeHi - tol : b.c < rangeLo + tol;
    const rV = b.v / avgV;
    const rS = (b.h - b.l) / avgS;
    const quiet = rV <= LPS_VOLUME && rS <= LPS_SPREAD;

    if (held && quiet) {
      return {
        verdict: "lps",
        label: up ? "LPS confirmed" : "LPSY confirmed",
        detail:
          `Break on ${sV.toFixed(2)}x volume, ${sS.toFixed(2)}x spread. Pullback on ${rV.toFixed(2)}x volume, ` +
          `${rS.toFixed(2)}x spread, and the level held — ${up ? "supply" : "demand"} did not show up. ` +
          `That absence is the signal.`,
        confirmed: true, warning: false,
        breakVolumeX: sV, breakSpreadX: sS, retestVolumeX: rV, retestSpreadX: rS,
      };
    }
    // It came back and it was NOT quiet — that is the failure case, and it is
    // the one worth saying out loud, because it looks identical on price.
    return {
      verdict: "supply-present",
      label: up ? "supply on the retest" : "demand on the retest",
      detail:
        `Break had effort (${sV.toFixed(2)}x volume) but the pullback came in on ${rV.toFixed(2)}x volume ` +
        `and a ${rS.toFixed(2)}x bar${held ? "" : ", closing back through the level"}. ` +
        `${up ? "Sellers are" : "Buyers are"} present — this is the break being ${up ? "sold" : "bought"} into, not an ${up ? "LPS" : "LPSY"}.`,
      confirmed: false, warning: true,
      breakVolumeX: sV, breakSpreadX: sS, retestVolumeX: rV, retestSpreadX: rS,
    };
  }

  return {
    verdict: "no-test-yet",
    label: up ? "SOS, awaiting LPS" : "SOW, awaiting LPSY",
    detail:
      `The break had real effort — ${sV.toFixed(2)}x volume on a ${sS.toFixed(2)}x bar. ` +
      `Price has not returned to the level yet, so there is nothing to grade. This is the one to set an alert on.`,
    confirmed: false, warning: false,
    breakVolumeX: sV, breakSpreadX: sS, retestVolumeX: null, retestSpreadX: null,
  };
}
