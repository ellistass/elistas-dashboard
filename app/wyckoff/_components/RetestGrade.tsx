"use client";
// app/wyckoff/_components/RetestGrade.tsx — grade the retest, don't just price it.
//
// The conservative entry is the LPS by geometry: buy the pullback into the
// broken edge. Geometry cannot tell an LPS from a breakout being sold into —
// both are "price came back to the level". Only volume and spread can.
//
// So the plan gets a verdict beside it. A confirmed LPS reads plainly; a
// pullback arriving on rising volume gets a warning, because that is the one
// that looks like an opportunity and is the opposite of one.

import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import type { RetestGrade as Grade } from "@/lib/wyckoff/retest";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export default function RetestGrade({ grade }: { grade?: Grade | null }) {
  if (!grade) return null;

  const tone = grade.confirmed ? "var(--green)" : grade.warning ? "var(--amber)" : "var(--text-3)";
  const Icon = grade.confirmed ? CheckCircle2 : grade.warning ? AlertTriangle : Clock;

  return (
    <div
      style={{
        display: "flex", gap: 8, padding: "8px 10px", borderRadius: 9, marginTop: 8,
        border: `1px solid ${grade.confirmed || grade.warning ? tone : "var(--border-subtle)"}`,
      }}
    >
      <Icon size={12} strokeWidth={2} style={{ color: tone, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ ...mono, fontSize: 10.5, fontWeight: 500, color: tone, letterSpacing: "0.02em" }}>
          {grade.label}
        </div>
        <div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", lineHeight: 1.6, marginTop: 3 }}>
          {grade.detail}
        </div>
        {/* Show the working — these are the two numbers the whole call rests on. */}
        {(grade.breakVolumeX != null || grade.retestVolumeX != null) && (
          <div style={{ ...mono, fontSize: 9, color: "var(--text-3)", marginTop: 5, opacity: 0.8 }}>
            {grade.breakVolumeX != null && `break ${grade.breakVolumeX.toFixed(2)}x vol`}
            {grade.breakSpreadX != null && ` · ${grade.breakSpreadX.toFixed(2)}x spread`}
            {grade.retestVolumeX != null && ` → retest ${grade.retestVolumeX.toFixed(2)}x vol`}
            {grade.retestSpreadX != null && ` · ${grade.retestSpreadX.toFixed(2)}x spread`}
            <span style={{ opacity: 0.7 }}> (vs the range's own average)</span>
          </div>
        )}
      </div>
    </div>
  );
}
