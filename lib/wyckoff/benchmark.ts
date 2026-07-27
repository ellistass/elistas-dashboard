// lib/wyckoff/benchmark.ts — you-vs-engine scoring (pure functions).
//
// A verdict is "correct" when the resolved outcome matches its implication:
//   accum   → up      (demand absorbed supply, range resolved higher)
//   distrib → down    (supply overwhelmed demand, range resolved lower)
//   pass / neutral → chop  (no edge called, and none materialised)
//
// Two accuracy views per side:
//   • overall  — all three verdicts scored as predictions (pass = "chop call")
//   • decisive — accum/distrib calls only (did the directional calls land?)
//
// The headline comparison runs BOTH sides over the SAME set of resolved
// candidates (those with a trader read), so the tallies are apples-to-apples.

export interface Tally {
  n: number; // verdicts scored
  correct: number;
  decisiveN: number; // accum/distrib calls only
  decisiveCorrect: number;
}

export type AnyVerdict = "accum" | "distrib" | "neutral" | "pass";

export function verdictCorrect(verdict: AnyVerdict, outcome: string): boolean {
  if (verdict === "accum") return outcome === "up";
  if (verdict === "distrib") return outcome === "down";
  return outcome === "chop"; // neutral / pass
}

export function emptyTally(): Tally {
  return { n: 0, correct: 0, decisiveN: 0, decisiveCorrect: 0 };
}

export function addToTally(t: Tally, verdict: AnyVerdict, outcome: string): void {
  const ok = verdictCorrect(verdict, outcome);
  t.n++;
  if (ok) t.correct++;
  if (verdict === "accum" || verdict === "distrib") {
    t.decisiveN++;
    if (ok) t.decisiveCorrect++;
  }
}

import { SUSPECT_VOLUME } from "./basket";

export interface BenchmarkRow {
  instrument: string;
  outcome: string | null;
  engineVerdict: string;
  traderVerdict: string | null;
  loggedBlind: boolean;
}

export interface Scoreboard {
  resolvedWithRead: number; // the shared sample both headline tallies use
  you: Tally; // your reads on resolved candidates
  engineSameSet: Tally; // engine on those SAME candidates (fair comparison)
  engineOverallBlind: Tally; // engine on every blind-logged resolved range
}

export function computeScoreboard(rows: BenchmarkRow[]): Scoreboard {
  const you = emptyTally();
  const engineSameSet = emptyTally();
  const engineOverallBlind = emptyTally();
  let resolvedWithRead = 0;

  for (const r of rows) {
    if (r.outcome == null) continue;
    // GOVERNING RULE (mapping spec §1): an engine verdict computed on suspect
    // volume is noise dressed as a verdict — those instruments are surfaced
    // and readable, but structurally EXCLUDED from every scoring tally. The
    // trader's chart reads on them use a real feed (TradingView), but keeping
    // the comparison apples-to-apples means both sides sit out here.
    if (SUSPECT_VOLUME.has(r.instrument)) continue;
    if (r.loggedBlind) {
      addToTally(engineOverallBlind, r.engineVerdict as AnyVerdict, r.outcome);
    }
    // The headline tallies require BOTH sides to have been blind before
    // resolution: a locked trader read AND a blind-logged engine verdict.
    // Seed rows (loggedBlind=false — outcome was already visible when first
    // logged) are STRUCTURALLY excluded even if a read was ever logged on one.
    if (r.traderVerdict != null && r.loggedBlind) {
      resolvedWithRead++;
      addToTally(you, r.traderVerdict as AnyVerdict, r.outcome);
      addToTally(engineSameSet, r.engineVerdict as AnyVerdict, r.outcome);
    }
  }
  return { resolvedWithRead, you, engineSameSet, engineOverallBlind };
}
