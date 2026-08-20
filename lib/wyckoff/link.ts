// lib/wyckoff/link.ts — connect a locked read to the trade you actually took.
//
// THE PROBLEM
// The read lives on /wyckoff and scores your chart-reading. The trade arrives
// from the MT4 EA and scores your money. They have never met, so the question
// that matters most — do I make money on the reads I get right? — has never
// been answerable. Worse: whether you followed your own plan is invisible.
//
// THE MATCH
// There is no button to press. You lock a read, you place the order in MT4, the
// EA posts an open event, and this module decides whether that fill belongs to
// a read you committed to. Same auto-match shape as the ticketless-placeholder
// flow already in /api/trades/mt4, matched against locked reads instead.
//
// The hard part is symbols. The scanner reads futures tickers (6B, KC, NKY);
// you execute CFDs (GBPUSD, COFFEE, JP225); your broker decorates those with
// suffixes (COFFEE.c, JP225.cash, EURUSDm). basket.ts already holds the middle
// hop via executeSymbol, so the chain is:
//
//     6B  --executeSymbol-->  GBPUSD  --suffix tolerance-->  GBPUSDm
//
// FAILURE MODE, ON PURPOSE
// When nothing matches confidently, we link NOTHING. A missing link costs you a
// row of analysis; a wrong link silently corrupts the "did I follow my read"
// number, which is the whole point of building this. Fail open, never guess.

import { executeCall, instrumentInfo } from "./basket";

/** How the trade related to the read you had committed to. */
export type ReadAdherence =
  /** Traded the direction you called. */
  | "aligned"
  /** Traded the OPPOSITE of your own locked read. */
  | "contradicted"
  /** You locked PASS, then traded it anyway. */
  | "traded-a-pass";

export interface LinkCandidate {
  id: string;
  instrument: string;
  traderVerdict: string | null;
  traderReadAt: Date | string | null;
}

export interface LinkTarget {
  /** Broker symbol exactly as MT4 reported it, e.g. "COFFEE.c". */
  brokerSymbol: string;
  direction: "Long" | "Short";
  /** Fill time — used to reject reads locked after the trade opened. */
  openedAt: Date | string;
}

export interface LinkResult {
  candidateId: string;
  adherence: ReadAdherence;
  /** Why this matched, for the API response and the audit trail. */
  reason: string;
}

/** Broker decoration stripped: upper-cased, non-alphanumerics removed.
 *  "COFFEE.c" → "COFFEEC", "JP225.cash" → "JP225CASH", "EURUSDm" → "EURUSDM". */
export function cleanSymbol(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Does a broker symbol denote this execute symbol?
 *
 *  Prefix match with a short tail allowance rather than an alias table, because
 *  broker suffixes are endless (.c, .cash, m, #, .pro, .raw) and unknowable in
 *  advance. The tail is capped at 4 characters so GBPUSD cannot swallow an
 *  unrelated GBPUSDSOMETHING, and matching is only ever consulted alongside a
 *  direction check and a time window — three weak signals, not one. */
export function symbolMatches(brokerSymbol: string, executeSymbol: string): boolean {
  if (!executeSymbol) return false;
  const b = cleanSymbol(brokerSymbol);
  const e = cleanSymbol(executeSymbol);
  if (!b || !e) return false;
  if (b === e) return true;
  return b.startsWith(e) && b.length - e.length <= 4;
}

/** Direction a locked read implies on the EXECUTE side, inversion applied.
 *  6J accum means JPY strength, which is USDJPY DOWN — getting this backwards
 *  would label a correctly-followed trade as a contradiction. */
export function impliedDirection(instrument: string, verdict: string): "Long" | "Short" | null {
  const call = executeCall(instrument, verdict);
  if (!call) return null;
  return call.action === "BUY" ? "Long" : "Short";
}

const DAY = 86_400_000;
const asTime = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isNaN(t) ? null : t;
};

/**
 * Pick the read this fill belongs to, or null.
 *
 * @param windowDays how long a locked read stays claimable. Default 14: long
 *        enough to cover "I read it Monday and it triggered the next week",
 *        short enough that a stale read cannot adopt an unrelated trade months
 *        later.
 */
export function matchReadToTrade(
  candidates: LinkCandidate[],
  trade: LinkTarget,
  windowDays = 14,
): LinkResult | null {
  const openedAt = asTime(trade.openedAt);
  if (openedAt == null) return null;

  const scored: Array<{ c: LinkCandidate; adherence: ReadAdherence; readAt: number; reason: string }> = [];

  for (const c of candidates) {
    if (!c.traderVerdict) continue;
    const readAt = asTime(c.traderReadAt);
    if (readAt == null) continue;

    // A read locked AFTER the fill cannot be the reason for the fill. This also
    // stops a read logged in hindsight from claiming credit for a trade.
    if (readAt > openedAt) continue;
    if (openedAt - readAt > windowDays * DAY) continue;

    const inst = instrumentInfo(c.instrument);
    if (!inst) continue;

    // Read-only instruments (no CFD) can still be matched by their own ticker —
    // stocks read and execute under the same symbol.
    const exec = inst.executeSymbol || c.instrument;
    if (!symbolMatches(trade.brokerSymbol, exec)) continue;

    if (c.traderVerdict === "pass") {
      scored.push({
        c, readAt, adherence: "traded-a-pass",
        reason: `locked PASS on ${c.instrument} and traded it anyway`,
      });
      continue;
    }

    const implied = impliedDirection(c.instrument, c.traderVerdict);
    if (!implied) continue;

    scored.push(
      implied === trade.direction
        ? { c, readAt, adherence: "aligned", reason: `${c.traderVerdict.toUpperCase()} on ${c.instrument} → ${trade.direction}` }
        : { c, readAt, adherence: "contradicted", reason: `locked ${c.traderVerdict.toUpperCase()} on ${c.instrument} but went ${trade.direction}` },
    );
  }

  if (!scored.length) return null;

  // Prefer a read you actually followed, then the most recent. Without the
  // first tiebreak, an old contradicting read on the same instrument could
  // outrank the aligned one you were really acting on.
  const rank: Record<ReadAdherence, number> = { aligned: 3, "traded-a-pass": 2, contradicted: 1 };
  scored.sort((a, b) => rank[b.adherence] - rank[a.adherence] || b.readAt - a.readAt);

  const best = scored[0];
  return { candidateId: best.c.id, adherence: best.adherence, reason: best.reason };
}

/** How far the fill drifted from the plan you committed to, in R.
 *  Null when the read carried no entry/stop — most do not, and inventing a
 *  drift figure from a missing plan would be worse than showing nothing. */
export function planDrift(params: {
  plannedEntry: number | null;
  plannedStop: number | null;
  actualEntry: number | null;
  actualStop: number | null;
}): { entryDriftR: number | null; stopWidenedR: number | null } {
  const { plannedEntry, plannedStop, actualEntry, actualStop } = params;
  if (!plannedEntry || !plannedStop || plannedEntry === plannedStop) {
    return { entryDriftR: null, stopWidenedR: null };
  }
  const plannedRisk = Math.abs(plannedEntry - plannedStop);
  const entryDriftR =
    actualEntry != null ? Number((Math.abs(actualEntry - plannedEntry) / plannedRisk).toFixed(2)) : null;
  const stopWidenedR =
    actualEntry != null && actualStop != null
      ? Number(((Math.abs(actualEntry - actualStop) - plannedRisk) / plannedRisk).toFixed(2))
      : null;
  return { entryDriftR, stopWidenedR };
}
