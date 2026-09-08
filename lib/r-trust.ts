// lib/r-trust.ts — when is an R value measuring anything?
//
// R = realised move / planned risk. It is only meaningful if the denominator is
// the stop the trade was actually FILLED with. A broker statement does not
// record that: it records the FINAL stop, after every modification. So every
// trade where the stop was moved to break-even imports with a "stop" sitting a
// fraction of a pip from entry, and R divides by almost nothing.
//
// The importer already knew this — "SL here is the FINAL SL (after any
// modifications), so R will be wrong for trades where you moved SL" — and
// guarded it with `entryPrice !== slPrice`. That catches only EXACT equality. A
// stop moved to entry + 0.2 pips is not equal, so it sailed through, and 301 of
// 685 statement-imported trades carry an R built on a denominator that is not a
// stop. Only 64 were loud enough (|R| > 10) to be noticed; 237 look perfectly
// reasonable and are equally meaningless.
//
// THE THRESHOLD IS EMPIRICAL, not taste. EA-captured stops are genuine — the EA
// records initialSlPrice at fill, before any modification — so they are the
// reference for what this trader's real stops look like:
//
//   EA-captured (n=46)        p10 0.089%   p25 0.106%   median 0.175%
//   broker-statement (n=687)  p10 0.005%   p25 0.021%   median 0.137%
//
// The two agree in the middle and diverge in the left tail. That tail is the
// artefact. 0.05% sits below all but 2 of the 46 genuine stops (~4%) while
// removing the tail — on this book, 0.05% of price is roughly 5 pips on a
// major, against a real median stop of ~17 pips.
//
// Nothing is deleted and nothing is guessed. Money P&L is untouched and remains
// exactly right; only the R is withheld, and it can be recomputed at any time
// because entryPrice, slPrice and closePrice all remain on the row.

/** Minimum stop distance, as a fraction of entry price, for R to be trusted. */
export const MIN_STOP_FRACTION = 0.0005; // 0.05%

export interface RTrustInput {
  entryPrice?: number | null;
  initialSlPrice?: number | null;
  slPrice?: number | null;
}

/** Stop distance as a fraction of entry price, or null when there is no stop. */
export function stopFraction(t: RTrustInput): number | null {
  const entry = t.entryPrice;
  // Same precedence as the live close handler: the stop AT FILL, falling back
  // to the current stop only for rows predating initialSlPrice. `||` not `??`,
  // because a position opened with no stop freezes initialSlPrice at 0.
  const sl = t.initialSlPrice || t.slPrice;
  if (!entry || !sl || entry <= 0 || sl <= 0) return null;
  return Math.abs(entry - sl) / entry;
}

/** Absorbs float error at the boundary. |entry - sl| / entry on a stop sitting
 *  exactly at the floor lands a few parts in 10^17 short of it, so a strict
 *  `>=` quietly rejects the very case the constant is defined by. Irrelevant to
 *  any real price, but a documented threshold should mean what it says. */
const EPS = 1e-12;

/** True when R computed from these prices is measuring a real planned risk. */
export function isRTrustworthy(t: RTrustInput): boolean {
  const f = stopFraction(t);
  return f != null && f >= MIN_STOP_FRACTION - EPS;
}

/** Why an R was rejected — for the import summary and the repair log. */
export function rRejectionReason(t: RTrustInput): string | null {
  const f = stopFraction(t);
  if (f == null) return "no stop recorded";
  if (f < MIN_STOP_FRACTION) {
    return `stop ${(f * 100).toFixed(4)}% from entry — below the ${(MIN_STOP_FRACTION * 100).toFixed(2)}% floor, so this is a moved/break-even stop, not the risk taken`;
  }
  return null;
}
