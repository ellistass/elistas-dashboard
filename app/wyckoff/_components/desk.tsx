"use client";
// app/wyckoff/_components/desk.tsx — ranking and the grade/reason chips.
//
// Ordering is the whole argument of the desk redesign. The old list came back
// ordered by `status desc, updatedAt desc`, which is the database's opinion,
// not a trader's: every card claimed equal urgency and the eye had nothing to
// anchor on. Here the order is explicit and defensible.

import type { PendingRow } from "./CandidateCard";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

/* ── Why a card is in front of you ─────────────────────────────────────────
   `isFresh()` has always known this and never persisted it. Now that it does,
   it becomes both the primary sort key and the answer to "why am I looking at
   this?" — which is also how you find out whether the scanner mostly catches
   setups at the test or only once they have already broken. */
export const REASON_LABEL: Record<string, string> = {
  "test-printed": "test just printed",
  "pressing-boundary": "pressing the edge",
  "just-broke-out": "already broke out",
};

/** Decision urgency. A test that printed this bar is a live decision; a range
 *  that has already broken out is a retest at best — the move started without
 *  you, so it sorts below things you can still get in front of. */
const REASON_RANK: Record<string, number> = {
  "test-printed": 3,
  "pressing-boundary": 2,
  "just-broke-out": 1,
};

export const GRADE_COLOR: Record<string, string> = {
  A: "var(--green)",
  B: "var(--accent)",
  C: "var(--text-2)",
  D: "var(--text-3)",
};

/** C and D stay on the desk but recede. Hiding them would mean trusting a
 *  grader that has no track record yet; dimming them means you can still audit
 *  what it demoted without clicking anything. */
export const isDimmed = (r: PendingRow) => r.grade === "C" || r.grade === "D";

export function rankCandidates(rows: PendingRow[]): PendingRow[] {
  return [...rows].sort((a, b) => {
    // 1. An alert you set that has been touched outranks everything — it is the
    //    one thing on this page that changed on its own since you last looked.
    const hit = (a.alertHitAt ? 1 : 0) - (b.alertHitAt ? 1 : 0);
    if (hit !== 0) return -hit;

    // 2. Ungraded rows (scanned before grading existed) sort with C-grade
    //    weight rather than to the bottom — absence of a grade is not evidence
    //    of a bad setup.
    const ga = a.gradeScore ?? 50;
    const gb = b.gradeScore ?? 50;

    // 3. Urgency band first, quality within the band. A B-grade decision you
    //    can still act on beats an A-grade that already left.
    const ra = REASON_RANK[a.surfacedReason ?? ""] ?? 2;
    const rb = REASON_RANK[b.surfacedReason ?? ""] ?? 2;
    if (ra !== rb) return rb - ra;
    if (ga !== gb) return gb - ga;

    // 4. Newest surfacing last — a tie between equals goes to the fresher one.
    const sa = a.surfacedAt ? Date.parse(a.surfacedAt) : 0;
    const sb = b.surfacedAt ? Date.parse(b.surfacedAt) : 0;
    return sb - sa;
  });
}

export function GradeChip({ grade, score, title }: { grade?: string | null; score?: number | null; title?: string }) {
  if (!grade) return null;
  const color = GRADE_COLOR[grade] ?? "var(--text-3)";
  return (
    <span
      title={title ?? (score != null ? `structural quality ${score}/100` : undefined)}
      style={{
        ...mono, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10,
        padding: "2px 8px", borderRadius: 999, border: `1px solid ${color}`, color,
        letterSpacing: "0.06em",
      }}
    >
      {grade}
      {score != null && <span style={{ color: "var(--text-3)" }}>{score}</span>}
    </span>
  );
}

export function ReasonChip({ reason }: { reason?: string | null }) {
  if (!reason) return null;
  const late = reason === "just-broke-out";
  return (
    <span
      title="why the scanner put this in front of you"
      style={{
        ...mono, fontSize: 10, padding: "2px 8px", borderRadius: 999,
        border: `1px solid ${late ? "var(--amber-border)" : "var(--border-subtle)"}`,
        color: late ? "var(--amber)" : "var(--text-3)",
      }}
    >
      {REASON_LABEL[reason] ?? reason}
    </span>
  );
}

/** Days since the range first reached a decision point. This is the number
 *  behind "I saw this at the test and then it went without me" — a setup that
 *  surfaced eleven days ago and is still sitting here has been quietly
 *  decaying in front of you. */
export function daysSinceSurfaced(r: PendingRow): number | null {
  if (!r.surfacedBarDate) return null;
  const t = Date.parse(`${r.surfacedBarDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
