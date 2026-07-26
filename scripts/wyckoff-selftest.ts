// scripts/wyckoff-selftest.ts — acceptance checks (§13) against synthetic bars.
// Run: npx tsx scripts/wyckoff-selftest.ts
// Pure-engine checks only (1,3,4,5 + open-range/freshness + verdict math);
// the DB/payload checks (2,6,7) are verified on the deployed routes.

import {
  CFG,
  cleanBars,
  detectRanges,
  contextPct,
  lastSpring,
  lastUpthrust,
  terminalTest,
  stoppingAction,
  engineVerdict,
  outcome,
  outcomeReady,
  isFresh,
  type Bar,
} from "../lib/wyckoff/engine";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const bar = (i: number, o: number, h: number, l: number, c: number, v = 1000): Bar => ({
  o, h, l, c, v, date: day(i),
});

// ── Build a synthetic tape ────────────────────────────────────────────────────
// The spec's detector is greedy left-to-right, so the tape must be adversary-
// free: a STEEP markdown (6 pts/bar — any seed straddling the transition gets
// rejected on MAXBAND or on zero ceiling touches) and a post-breakout rally
// that GAPS far above every inflated straddle band (so late rally bars can't
// count as ceiling "touches" for a wider phantom range).
//
// 0..69    : markdown 518 -> 104 (context for the range)
// 70..99   : range, floor 100 / ceiling 106 (30 bars, both boundaries touched)
//            bar 85 = spring (low 98.5 < floor, close 101 >= floor)
// 100      : breakout bar (close 108 > ceiling + tol)
// 101..120 : resolution gap to 140, drift up
const M = 70; // markdown length
function rangeBar(i: number, k: number, springAt: number): Bar {
  if (k === springAt) return bar(i, 101, 101.5, 98.5, 101, 2500); // spring
  if (k % 6 === 0) return bar(i, 104, 106, 103, 104.5, 1200); // ceiling touch (h=106)
  if (k % 6 === 3) return bar(i, 102, 103, 100, 101.5, 1400); // floor touch (l=100)
  return bar(i, 102.5, 104.5, 101.5, 103, 900); // interior bar
}
function syntheticTape(): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < M; i++) {
    const px = 518 - i * 6; // 518 -> 104
    bars.push(bar(i, px + 0.5, px + 1, px - 1, px, 1000));
  }
  for (let i = M; i < M + 30; i++) bars.push(rangeBar(i, i - M, 15));
  bars.push(bar(M + 30, 105, 108.5, 104.5, 108, 3000)); // breakout close above hi+tol
  for (let i = M + 31; i <= M + 50; i++) {
    const px = 140 + (i - (M + 31)) * 0.35; // gap up, then drift
    bars.push(bar(i, px, px + 0.6, px - 0.6, px, 1500));
  }
  return bars;
}

console.log("— §3 detection + §4 context + §5 spring + §9 outcome —");
{
  const bars = syntheticTape();
  const ranges = detectRanges(bars);
  check("exactly one range detected", ranges.length === 1, `got ${ranges.length}`);
  const r = ranges[0];
  check("range starts at the base", r.start >= M - 1 && r.start <= M, `start=${r.start}`);
  check("range broke out at the breakout bar", r.status === "broken" && r.end === M + 30, `end=${r.end} status=${r.status}`);
  check("floor/ceiling = 100/106", r.lo === 100 && r.hi === 106, `lo=${r.lo} hi=${r.hi}`);

  // §4 hand check: contextPct = (c[start] - c[start-60]) / c[start-60] * 100
  const cp = contextPct(bars, r.start)!;
  const a = r.start - CFG.CONTEXT_BARS;
  const hand = ((bars[r.start].c - bars[a].c) / bars[a].c) * 100;
  check("contextPct matches hand formula", Math.abs(cp - hand) < 1e-9, `cp=${cp} hand=${hand}`);
  check("context is a markdown (negative)", cp < -3, `cp=${cp.toFixed(1)}`);

  // §5: spring flagged at bar M+15 (low 98.5 < floor 100, close 101 >= floor)
  const s = lastSpring(bars, r.start, r.end, r.lo);
  const u = lastUpthrust(bars, r.start, r.end, r.hi);
  check("spring found at the spring bar", s === M + 15, `spring=${s}`);
  check("terminalTest = spring", terminalTest(s, u) === "spring", `got ${terminalTest(s, u)}`);

  // §9: 20 bars after end exist (> RESOLVE_BARS=12) -> outcome final
  check("outcomeReady after 12 fwd bars", outcomeReady(bars.length, r.end));
  check("outcome = up", outcome(bars, r.end, r.lo, r.hi) === "up");

  // §8 verdict sanity: some verdict is produced
  const v = engineVerdict(bars, r.start, r.end);
  check("engineVerdict in domain", ["accum", "distrib", "neutral"].includes(v), v);
}

console.log("— §5 spring rule precision (check 5) —");
{
  // A bar with low < floor but close BELOW floor must NOT be a spring.
  const floor = 100;
  const tape: Bar[] = [
    bar(0, 101, 102, 99, 99.5), // pierced but closed below floor -> not a spring
    bar(1, 101, 102, 99, 100.0), // pierced, closed exactly at floor -> spring (c >= lo)
  ];
  check("close below floor is NOT a spring", lastSpring(tape, 0, 1, floor) === null);
  check("close at floor IS a spring", lastSpring(tape, 0, 2, floor) === 1);
  // Upthrust mirror
  const ceil = 110;
  const tape2: Bar[] = [bar(0, 109, 111, 108, 110.5), bar(1, 109, 111, 108, 109.5)];
  check("close above ceiling is NOT an upthrust", lastUpthrust(tape2, 0, 1, ceil) === null);
  check("pierce + close back inside IS an upthrust", lastUpthrust(tape2, 0, 2, ceil) === 1);
}

console.log("— §3 MAXBAND rejection (check 3) —");
{
  // Seed band 40% of mid -> must never produce a range even with touches.
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) {
    const wide = i % 2 === 0;
    bars.push(bar(i, 100, wide ? 130 : 105, wide ? 80 : 95, wide ? 128 : 96)); // band ~50 on mid ~105
  }
  const ranges = detectRanges(bars);
  check("no range wider than MAXBAND", ranges.every((r) => (r.hi - r.lo) / ((r.hi + r.lo) / 2) <= CFG.MAXBAND));
}

console.log("— §1 bar hygiene —");
{
  const dirty: Bar[] = [bar(0, 1, 2, 0.5, 1.5), { ...bar(1, 1, 2, 0.5, 1.5), v: 0 }, { ...bar(2, 1, 2, 0.5, 1.5), c: NaN }];
  check("zero-volume and NaN bars dropped", cleanBars(dirty).length === 1);
}

console.log("— open range + freshness (build-time extension) —");
{
  // Range that runs to the right edge with a spring on the last bar.
  const bars: Bar[] = [];
  for (let i = 0; i < M; i++) {
    const px = 518 - i * 6;
    bars.push(bar(i, px + 0.5, px + 1, px - 1, px));
  }
  for (let i = M; i < M + 25; i++) bars.push(rangeBar(i, i - M, 24)); // spring prints on the LAST bar
  const ranges = detectRanges(bars);
  check("open range detected at right edge", ranges.length === 1 && ranges[0].status === "open", JSON.stringify(ranges));
  if (ranges.length === 1) {
    const r = ranges[0];
    const s = lastSpring(bars, r.start, r.end, r.lo);
    const u = lastUpthrust(bars, r.start, r.end, r.hi);
    check("fresh: open + terminal test just printed", isFresh(bars, r, s, u) === true);
  }
}

console.log("— stale range is NOT fresh —");
{
  const bars = syntheticTape(); // breakout at 90, tape ends at 110 -> 20 bars ago
  const r = detectRanges(bars)[0];
  const s = lastSpring(bars, r.start, r.end, r.lo);
  const u = lastUpthrust(bars, r.start, r.end, r.hi);
  check("breakout 20 bars ago filtered out", isFresh(bars, r, s, u) === false);
}

console.log("— §8 verdict math on a contrived tape —");
{
  // Up-moves need 3000 vol per +1pt; down-moves need 1000 per -1pt.
  // ratio = 3000/1000 = 3 >= 1.12 -> distribution.
  const seg: Bar[] = [bar(0, 100, 101, 99, 100)];
  for (let i = 1; i <= 10; i++) {
    const up = i % 2 === 1;
    const prev = seg[i - 1].c;
    const c = up ? prev + 1 : prev - 1;
    seg.push(bar(i, prev, Math.max(prev, c) + 0.2, Math.min(prev, c) - 0.2, c, up ? 3000 : 1000));
  }
  check("expensive up-travel => distrib", engineVerdict(seg, 0, seg.length) === "distrib");
  // Flip volumes -> accumulation
  const seg2 = seg.map((b, i) => (i === 0 ? b : { ...b, v: b.c > seg[i - 1].c ? 1000 : 3000 }));
  check("expensive down-travel => accum", engineVerdict(seg2, 0, seg2.length) === "accum");
}

console.log("— §6 stopping action —");
{
  // Climax down-bar (huge vol, wide range, close upper half) then rally.
  const seg: Bar[] = [];
  for (let i = 0; i < 6; i++) seg.push(bar(i, 105 - i, 106 - i, 103 - i, 104 - i, 1000));
  seg.push(bar(6, 98, 99, 90, 95.5, 9000)); // climax: range 9 (avg ~3+), close upper half, max vol
  seg.push(bar(7, 96, 105.5, 95, 105, 4000)); // automatic rally: 105 > 95.5 + 9 = 104.5
  for (let i = 8; i < 12; i++) seg.push(bar(i, 104, 105, 103, 104, 1200));
  check("climax + automatic rally flagged", stoppingAction(seg, 0, seg.length) === true);
  // Same tape without the rally -> false
  const noRally = seg.map((b, i) => (i === 7 ? bar(7, 96, 99, 95, 96, 1200) : b));
  check("climax without rally NOT flagged", stoppingAction(noRally, 0, noRally.length) === false);
}

console.log("— benchmark scoring (you vs engine) —");
{
  // Deferred import keeps the engine tests standalone.
  const { verdictCorrect, computeScoreboard } = require("../lib/wyckoff/benchmark") as typeof import("../lib/wyckoff/benchmark");
  check("accum + up = correct", verdictCorrect("accum", "up"));
  check("accum + down = wrong", !verdictCorrect("accum", "down"));
  check("distrib + down = correct", verdictCorrect("distrib", "down"));
  check("pass + chop = correct", verdictCorrect("pass", "chop"));
  check("neutral + up = wrong", !verdictCorrect("neutral", "up"));

  const sb = computeScoreboard([
    // resolved, read logged: you right (accum/up), engine wrong (distrib)
    { outcome: "up", engineVerdict: "distrib", traderVerdict: "accum", loggedBlind: true },
    // resolved, read logged: both right
    { outcome: "down", engineVerdict: "distrib", traderVerdict: "distrib", loggedBlind: true },
    // resolved, NO read: engine-overall only
    { outcome: "chop", engineVerdict: "neutral", traderVerdict: null, loggedBlind: true },
    // resolved seed row (not blind): excluded from engine-overall-blind
    { outcome: "up", engineVerdict: "accum", traderVerdict: null, loggedBlind: false },
    // unresolved: excluded everywhere
    { outcome: null, engineVerdict: "accum", traderVerdict: "accum", loggedBlind: true },
  ]);
  check("shared sample = 2", sb.resolvedWithRead === 2, String(sb.resolvedWithRead));
  check("you 2/2", sb.you.n === 2 && sb.you.correct === 2);
  check("engine same-set 1/2", sb.engineSameSet.n === 2 && sb.engineSameSet.correct === 1);
  check("engine overall-blind 2/3 (seed excluded)", sb.engineOverallBlind.n === 3 && sb.engineOverallBlind.correct === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
