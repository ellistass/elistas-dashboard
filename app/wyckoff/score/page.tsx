"use client";
// app/wyckoff/score/page.tsx — am I improving, and is the scanner on time?
//
// Two questions, deliberately kept apart:
//   • Your read vs the engine's, on the shared blind sample (ScoreStrip).
//   • Whether the setups arrive early enough to act on (the timing panel).
//
// The second one exists because "I saw that move and it felt like I left it at
// the range test" is a measurable claim, not a mood. Lead-to-breakout says how
// many bars of warning you actually got; lead-to-test says whether you met the
// setup before or after its trigger printed. They are reported separately —
// a scanner can be generous on one and useless on the other.

import { TrendingUp, Timer } from "lucide-react";
import ScoreStrip from "../_components/ScoreStrip";
import { useWyckoff } from "../_components/WyckoffData";
import { summariseLeads } from "@/lib/wyckoff/timing";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../_components/ui";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export default function ScorePage() {
  const { score, passRate, resolved, loading, error } = useWyckoff();
  if (loading) return <LoadingCard what="benchmark" />;

  const toBreakout = summariseLeads(resolved.map((r) => r.leadToBreakout ?? null));
  const toTest = summariseLeads(resolved.map((r) => r.leadToTest ?? null));

  // Grade cohorts — does the grader actually predict anything? Until there is
  // enough resolved data this is honestly reported as "not enough yet" rather
  // than shown as a precise-looking percentage built on four cases.
  const byGrade = ["A", "B", "C", "D"].map((g) => {
    const rows = resolved.filter((r) => r.grade === g && (r.outcome === "up" || r.outcome === "down"));
    return { grade: g, n: rows.length };
  });

  return (
    <>
      {error && <ErrorCard message={error} />}

      <SectionHeader icon={<TrendingUp size={13} strokeWidth={2} />} title="You vs the engine" note="blind sample only" />
      {score ? <ScoreStrip score={score} passRate={passRate} /> : <EmptyState small text="No resolved reads yet." />}

      <SectionHeader
        icon={<Timer size={13} strokeWidth={2} />}
        title="Scanner timing"
        note="how much warning you actually got · measured in trading days"
      />

      {toBreakout.n === 0 && toTest.n === 0 ? (
        <EmptyState
          small
          text="No timing data yet. Lead times are only recorded for setups that surfaced after timing tracking was added — there is no honest way to backfill when a past setup first appeared, so this fills in from the next scan onward."
        />
      ) : (
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 0, padding: 0, marginBottom: 26, overflow: "hidden" }}>
          <LeadPanel
            title="Lead to breakout"
            hint="bars between the setup appearing and the move starting"
            s={toBreakout}
            lateLabel="surfaced at or after the breakout"
          />
          <LeadPanel
            title="Lead to terminal test"
            hint="negative means the spring or upthrust had already printed"
            s={toTest}
            lateLabel="met the setup after its trigger"
            bordered
          />
        </div>
      )}

      <SectionHeader
        title="Grade cohorts"
        note="does the quality grade predict anything? — sample sizes first, verdicts later"
      />
      <div className="card" style={{ padding: "16px 20px", marginBottom: 30 }}>
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          {byGrade.map((g) => (
            <div key={g.grade}>
              <p className="kicker" style={{ margin: "0 0 5px" }}>Grade {g.grade}</p>
              <p style={{ ...mono, margin: 0, fontSize: 19, fontWeight: 500, color: "var(--text-1)" }}>{g.n}</p>
              <p style={{ ...mono, margin: "4px 0 0", fontSize: 9.5, color: "var(--text-3)" }}>directional cases</p>
            </div>
          ))}
        </div>
        <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "14px 0 0", lineHeight: 1.6 }}>
          Win rates per grade appear once each cohort clears 20 resolved directional cases. Showing a
          percentage before then would dress up noise as evidence — and the grader is the thing being
          tested here, so it deserves a real sample before it earns your trust.
        </p>
      </div>
    </>
  );
}

function LeadPanel({ title, hint, s, lateLabel, bordered }: {
  title: string; hint: string; lateLabel: string; bordered?: boolean;
  s: { n: number; median: number | null; lateCount: number; latePct: number | null };
}) {
  return (
    <div style={{
      flex: "1 1 300px", padding: "18px 24px",
      borderLeft: bordered ? "1px solid var(--border-subtle)" : undefined,
    }}>
      <p className="kicker" style={{ margin: "0 0 6px" }}>{title}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
        <span style={{ ...mono, fontSize: 28, lineHeight: 1, fontWeight: 500, color: "var(--text-1)" }}>
          {s.median == null ? "—" : `${s.median > 0 ? "+" : ""}${s.median}`}
        </span>
        <span style={{ ...mono, fontSize: 11, color: "var(--text-3)" }}>median bars · n={s.n}</span>
      </div>
      <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "8px 0 0" }}>{hint}</p>
      {s.latePct != null && (
        <p style={{ ...mono, fontSize: 11, margin: "9px 0 0", color: s.latePct > 40 ? "var(--amber)" : "var(--text-2)" }}>
          {s.latePct}% late — {s.lateCount} of {s.n} {lateLabel}
        </p>
      )}
    </div>
  );
}
