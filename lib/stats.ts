// lib/stats.ts — a percentage is not a number, it is a claim about a sample.
//
// This app shows a lot of rates: your read accuracy vs the engine's, win rate
// by model, by session, by grade, engine hit rate, pass rate. They are rendered
// identically whether they rest on 800 trades or on 2, which means the page
// cannot distinguish a finding from a coincidence — and neither can the reader.
//
// Measured on the live book:
//   • "Win rate by model"  — 2 trades carry a model. 757 do not.
//   • "Grade performance"  — 2 trades carry a grade. 757 do not.
//   • "You vs engine"      — 14 blind reads.
//   • Grade cohorts        — A 14, B 36, C 31, D 8.
//
// Every one of those was displayed as a clean percentage next to metrics built
// on hundreds. So: no rate leaves this module without its n attached, and
// below a floor no percentage is produced at all — only the raw count, which
// is the honest thing a sample of four has to say.
//
// The bands are the usual ones for a proportion, chosen by the width of the
// interval rather than by taste. At n=30 and p=0.5 the 95% margin is ~18
// points; at n=10 it is ~31, which is not an estimate of anything.

export const MIN_RATE_N = 10;      // below this, no percentage at all
export const SOLID_RATE_N = 30;    // at or above this, report it plainly

export type Confidence = "none" | "provisional" | "solid";

export interface Rate {
  hits: number;
  n: number;
  /** null below MIN_RATE_N — deliberately not a number you can accidentally render. */
  pct: number | null;
  confidence: Confidence;
  /** 95% margin of error in percentage points, null when pct is null. */
  marginPct: number | null;
  /** Ready to render: "62%" / "3 of 7" / "—". */
  label: string;
  /** For a title attribute — says what the number is and is not. */
  title: string;
}

/**
 * Build a rate that cannot be rendered dishonestly.
 *
 * Wald interval rather than Wilson: it is the one whose width matches the
 * intuition the label is trying to convey, and at these sample sizes the
 * difference between the two is far smaller than the number being disclosed.
 */
export function rate(hits: number, n: number): Rate {
  if (!Number.isFinite(hits) || !Number.isFinite(n) || n <= 0) {
    return { hits: 0, n: 0, pct: null, confidence: "none", marginPct: null, label: "—", title: "no data yet" };
  }
  if (n < MIN_RATE_N) {
    return {
      hits, n, pct: null, confidence: "none", marginPct: null,
      label: `${hits} of ${n}`,
      title: `Only ${n} case${n === 1 ? "" : "s"} — too few for a percentage to mean anything, so the raw count is shown instead. A rate appears at ${MIN_RATE_N}.`,
    };
  }
  const p = hits / n;
  const margin = Math.round(1.96 * Math.sqrt((p * (1 - p)) / n) * 100);
  const pct = Math.round(p * 100);
  const solid = n >= SOLID_RATE_N;
  return {
    hits, n, pct,
    confidence: solid ? "solid" : "provisional",
    marginPct: margin,
    label: `${pct}%`,
    title: solid
      ? `${hits} of ${n} · 95% confidence this sits within ±${margin} points`
      : `${hits} of ${n} — provisional. 95% confidence only places this within ±${margin} points; it firms up at ${SOLID_RATE_N} cases.`,
  };
}

/** Two rates over the same sample, for "you vs engine" style comparisons.
 *  Returns whether the gap between them is even distinguishable from noise —
 *  the question the side-by-side tiles silently invite and never answer. */
export function compareRates(a: Rate, b: Rate): {
  gapPct: number | null;
  meaningful: boolean;
  note: string;
} {
  if (a.pct == null || b.pct == null) {
    return { gapPct: null, meaningful: false, note: "not enough resolved cases to compare" };
  }
  const gap = a.pct - b.pct;
  // Comparing two proportions on the SAME cases: the gap has to clear the
  // combined margin before it is worth reading as a difference at all.
  const combined = Math.sqrt((a.marginPct ?? 0) ** 2 + (b.marginPct ?? 0) ** 2);
  const meaningful = Math.abs(gap) > combined;
  return {
    gapPct: gap,
    meaningful,
    note: meaningful
      ? `${Math.abs(gap)} points apart on ${a.n} shared cases`
      : `${Math.abs(gap)} points apart, which is inside the noise on ${a.n} cases — not yet a difference`,
  };
}

/** Sample-size caveat for a whole panel, or null when the sample is fine. */
export function sampleNote(n: number, what = "cases"): string | null {
  if (n >= SOLID_RATE_N) return null;
  if (n < MIN_RATE_N) return `${n} ${what} — too few to read as a rate.`;
  return `${n} ${what} — provisional until ${SOLID_RATE_N}.`;
}

/** Share of rows that carry a field at all. A breakdown over a field that is
 *  mostly blank is not a breakdown; it is a report on the exception. */
export function coverage(present: number, total: number): {
  present: number; total: number; pct: number; usable: boolean; note: string | null;
} {
  const pct = total > 0 ? Math.round((present / total) * 100) : 0;
  return {
    present, total, pct,
    usable: pct >= 50,
    note: total === 0 ? null
      : pct >= 50 ? null
      : `Only ${present} of ${total} trades (${pct}%) carry this, so the split below describes those ${present} — not your trading.`,
  };
}
