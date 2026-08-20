// Sanity check for gradeRange — synthetic bars, no I/O.
// Goal: prove the grader separates a textbook setup from a scrappy one, and
// that each factor actually moves the score in the direction claimed.
import { gradeRange } from "../lib/wyckoff/grade";
import type { Bar } from "../lib/wyckoff/engine";

function bar(o: number, h: number, l: number, c: number, i: number): Bar {
  return { o, h, l, c, v: 1000, date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` };
}

/** Build a range of `n` bars oscillating between lo and hi, with `touches`
 *  bars reaching each boundary, preceded by `ctxBars` of trend. */
function series(opts: {
  n: number;
  lo: number;
  hi: number;
  touches: number;
  ctxBars: number;
  ctxPct: number;
  springAt?: number; // index within the range
}): { bars: Bar[]; start: number; end: number } {
  const bars: Bar[] = [];
  const startPx = opts.lo + (opts.hi - opts.lo) / 2;
  const from = startPx / (1 + opts.ctxPct / 100);
  for (let i = 0; i < opts.ctxBars; i++) {
    const px = from + ((startPx - from) * i) / Math.max(1, opts.ctxBars - 1);
    bars.push(bar(px, px * 1.002, px * 0.998, px, i));
  }
  const start = bars.length;
  const mid = (opts.lo + opts.hi) / 2;
  for (let k = 0; k < opts.n; k++) {
    const touchHi = k % Math.max(2, Math.floor(opts.n / opts.touches)) === 0;
    const touchLo = k % Math.max(2, Math.floor(opts.n / opts.touches)) === 1;
    let h = touchHi ? opts.hi : mid + (opts.hi - mid) * 0.4;
    let l = touchLo ? opts.lo : mid - (mid - opts.lo) * 0.4;
    let c = mid;
    if (opts.springAt != null && k === opts.springAt) {
      l = opts.lo * 0.995; // pierce the floor
      c = opts.lo * 1.001; // close back inside
    }
    bars.push(bar(mid, h, l, c, bars.length));
  }
  return { bars, start, end: bars.length };
}

function run(label: string, cfg: Parameters<typeof series>[0], extra: {
  touchesHi: number; touchesLo: number; springIdx: number | null;
  terminalTest: "spring" | "upthrust" | "both" | "none"; contextPct: number | null;
}) {
  const { bars, start, end } = series(cfg);
  const g = gradeRange({
    bars, start, end, lo: cfg.lo, hi: cfg.hi,
    touchesHi: extra.touchesHi, touchesLo: extra.touchesLo,
    springIdx: extra.springIdx, upthrustIdx: null,
    terminalTest: extra.terminalTest, contextPct: extra.contextPct,
  });
  console.log(
    `${label.padEnd(26)} ${g.grade}  score=${String(g.score).padStart(3)}  ` +
      `test=${g.factors.test.toFixed(2)} bnd=${g.factors.boundaries.toFixed(2)} ` +
      `ctx=${g.factors.context.toFixed(2)} mat=${g.factors.maturity.toFixed(2)}`,
  );
  console.log(`${" ".repeat(28)}${g.notes.join(" · ")}`);
  return g;
}

const textbook = run("textbook spring", {
  n: 40, lo: 100, hi: 106, touches: 5, ctxBars: 70, ctxPct: -22, springAt: 38,
}, { touchesHi: 5, touchesLo: 5, springIdx: 108, terminalTest: "spring", contextPct: -22 });

const stale = run("same range, stale test", {
  n: 40, lo: 100, hi: 106, touches: 5, ctxBars: 70, ctxPct: -22, springAt: 10,
}, { touchesHi: 5, touchesLo: 5, springIdx: 80, terminalTest: "spring", contextPct: -22 });

const noTest = run("no terminal test", {
  n: 40, lo: 100, hi: 106, touches: 5, ctxBars: 70, ctxPct: -22,
}, { touchesHi: 5, touchesLo: 5, springIdx: null, terminalTest: "none", contextPct: -22 });

const thinEdges = run("bare-minimum touches", {
  n: 40, lo: 100, hi: 106, touches: 2, ctxBars: 70, ctxPct: -22, springAt: 38,
}, { touchesHi: 2, touchesLo: 2, springIdx: 108, terminalTest: "spring", contextPct: -22 });

const noContext = run("flat context", {
  n: 40, lo: 100, hi: 106, touches: 5, ctxBars: 70, ctxPct: 0.5, springAt: 38,
}, { touchesHi: 5, touchesLo: 5, springIdx: 108, terminalTest: "spring", contextPct: 0.5 });

const incoherent = run("spring after a RALLY", {
  n: 40, lo: 100, hi: 106, touches: 5, ctxBars: 70, ctxPct: 22, springAt: 38,
}, { touchesHi: 5, touchesLo: 5, springIdx: 108, terminalTest: "spring", contextPct: 22 });

const scrappy = run("scrappy young wide box", {
  n: 16, lo: 100, hi: 126, touches: 2, ctxBars: 70, ctxPct: 1, springAt: undefined,
}, { touchesHi: 2, touchesLo: 2, springIdx: null, terminalTest: "none", contextPct: 1 });

console.log("\n── assertions ──");
const checks: Array<[string, boolean]> = [
  ["textbook outranks stale test", textbook.score > stale.score],
  ["textbook outranks no test", textbook.score > noTest.score],
  ["textbook outranks thin edges", textbook.score > thinEdges.score],
  ["textbook outranks flat context", textbook.score > noContext.score],
  ["coherent outranks incoherent ctx", textbook.score > incoherent.score],
  ["scrappy box is the worst", scrappy.score < Math.min(stale.score, noTest.score, thinEdges.score)],
  ["textbook grades A or B", textbook.grade === "A" || textbook.grade === "B"],
  ["scrappy grades C or D", scrappy.grade === "C" || scrappy.grade === "D"],
  ["all scores within 0..100", [textbook, stale, noTest, thinEdges, noContext, incoherent, scrappy].every((g) => g.score >= 0 && g.score <= 100)],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nAll assertions passed." : `\n${failed} FAILED`);

console.log("\n── post-fix checks ──");
const post: Array<[string, boolean]> = [
  ["stale test beats no test at all", stale.score > noTest.score],
  ["no coherence flag on a flat context", !noContext.notes.some((n) => n.includes("against the prior trend"))],
  ["thin edges cannot reach A", thinEdges.grade !== "A"],
  ["no-test range cannot reach A", noTest.grade !== "A"],
];
let pf = 0;
for (const [name, ok] of post) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) pf++; }
console.log(pf === 0 ? "Post-fix checks passed." : `${pf} FAILED`);
