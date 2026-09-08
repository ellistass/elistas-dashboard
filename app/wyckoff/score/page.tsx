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

import { GraduationCap, TrendingUp, Timer, Scale } from "lucide-react";
import ScoreStrip from "../_components/ScoreStrip";
import { useWyckoff } from "../_components/WyckoffData";
import { summarizeLearnable } from "@/lib/wyckoff/learnable";
import { summariseLeads } from "@/lib/wyckoff/timing";
import { rate, SOLID_RATE_N } from "@/lib/stats";
import { RateValueText } from "@/app/_components/Rate";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../_components/ui";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export default function ScorePage() {
  const { score, passRate, learnable, resolved, engineEdge, loading, error } = useWyckoff();
  if (loading) return <LoadingCard what="benchmark" />;

  const learnableStats = learnable ?? summarizeLearnable(resolved);
  const toBreakout = summariseLeads(resolved.map((r) => r.leadToBreakout ?? null));
  const toTest = summariseLeads(resolved.map((r) => r.leadToTest ?? null));

  // Grade cohorts — does the grader actually predict anything? Until there is
  // enough resolved data this is honestly reported as "not enough yet" rather
  // than shown as a precise-looking percentage built on four cases.
  const byGrade = ["A", "B", "C", "D"].map((g) => {
    const rows = resolved.filter((r) => r.grade === g && (r.outcome === "up" || r.outcome === "down"));
    // "Does the grade predict anything" is a question about the ENGINE's call
    // on those rows — the only side with enough resolved cases to ask.
    const hits = rows.filter((r) =>
      (r.engineVerdict === "accum" && r.outcome === "up") ||
      (r.engineVerdict === "distrib" && r.outcome === "down"),
    ).length;
    return { grade: g, n: rows.length, r: rate(hits, rows.length) };
  });

  return (
    <>
      {error && <ErrorCard message={error} />}

      <SectionHeader icon={<TrendingUp size={13} strokeWidth={2} />} title="You vs the engine" note="blind sample only" />
      {score ? <ScoreStrip score={score} passRate={passRate} /> : <EmptyState small text="No resolved reads yet." />}

      <SectionHeader
        icon={<Scale size={13} strokeWidth={2} />}
        title="Does the engine beat doing nothing?"
        note="accuracy is meaningless without the base rate — this is the comparison"
      />
      <EdgePanel edge={engineEdge} />

      <SectionHeader
        icon={<GraduationCap size={13} strokeWidth={2} />}
        title="Learnable cases"
        note="trusted volume · engine made a direction call · market resolved directionally"
      />
      <LearnablePanel stats={learnableStats} />

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
              <RateValueText rate={g.r} size={19} />
              <p style={{ ...mono, margin: "4px 0 0", fontSize: 9.5, color: "var(--text-3)" }}>
                {g.r.pct != null ? "engine hit rate" : "directional cases"}
              </p>
            </div>
          ))}
        </div>
        <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "14px 0 0", lineHeight: 1.6 }}>
          Hit rates appear once a cohort clears {SOLID_RATE_N} resolved directional cases, and are
          marked provisional below that. Showing a bare percentage earlier would dress up noise as
          evidence — and the grader is the thing being tested here, so it deserves a real sample
          before it earns your trust.
        </p>
      </div>
    </>
  );
}

/* ── The comparison the Score page was missing ──────────────────────────────
   "The engine is at 56%" invites 50% as the bar. It is not the bar. On this
   book price finished above the box 471 times and below it 316, so a model
   that says "up" every time and thinks about nothing scores 60% on directional
   cases — and 56% is worse than that.

   Reported per segment, because the average hides an inversion: the ACCUM
   calls look strong (63%) and are almost entirely the drift, while the DISTRIB
   calls look weak (48%) and carry the real edge, being 8 points above the 40%
   base rate for down. No amount of looking at 63 and 48 gets you there. */
function EdgePanel({ edge }: {
  edge: { base: { up: number; down: number; chop: number; pUp: number }; segments: Array<{ key: string; label: string; result: { verdict: string; edgePts: number | null; real: boolean; accuracy: { n: number; pct: number | null } } }> } | null;
}) {
  if (!edge) return <EmptyState small text="Not enough resolved ranges yet to compare the engine against the base rate." />;
  const basePct = Math.round(edge.base.pUp * 100);
  return (
    <div className="card" style={{ padding: "16px 20px", marginBottom: 26 }}>
      <p style={{ ...mono, fontSize: 10.5, color: "var(--text-2)", margin: "0 0 14px", lineHeight: 1.7 }}>
        Across every resolved range, price finished above the box{" "}
        <span style={{ color: "var(--text-1)" }}>{edge.base.up}</span> times and below it{" "}
        <span style={{ color: "var(--text-1)" }}>{edge.base.down}</span>. So on directional cases,
        always guessing “up” scores <span style={{ color: "var(--text-1)" }}>{basePct}%</span> —
        that is the bar, not 50%.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {edge.segments.map((s) => {
          const pts = s.result.edgePts;
          const color = !s.result.real ? "var(--text-3)" : (pts ?? 0) > 0 ? "var(--green)" : "var(--amber)";
          return (
            <div
              key={s.key}
              style={{
                display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
                padding: "9px 0", borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-1)", minWidth: 168 }}>{s.label}</span>
              <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>{s.result.verdict}</span>
              {pts != null && s.result.real && (
                <span style={{ ...mono, fontSize: 12, fontWeight: 500, color, marginLeft: "auto" }}>
                  {pts > 0 ? "+" : ""}{pts} pts
                </span>
              )}
              {!s.result.real && (
                <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginLeft: "auto" }}>no edge</span>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "13px 0 0", lineHeight: 1.7 }}>
        A segment only claims an edge when the gap from its base rate clears its own margin of error.
        Everything else is reported as “no edge” however good the percentage looks — which is the
        whole point, since the strongest-looking number here (ACCUM at 63%) is very nearly just the
        drift, and the worst-looking one (DISTRIB at 48%) is the one actually beating its base rate.
      </p>
    </div>
  );
}

function LearnablePanel({ stats }: {
  stats: { total: number; successes: number; failures: number; accum: number; distrib: number };
}) {
  const hitRate = rate(stats.successes, stats.total);
  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 0, padding: 0, marginBottom: 26, overflow: "hidden" }}>
      <LearnableCell
        label="Learnable"
        value={String(stats.total)}
        detail="clean resolved training cases"
      />
      <LearnableCell
        label="Engine hit rate"
        value={hitRate.label}
        valueTitle={hitRate.title}
        detail={stats.total ? `${stats.successes} of ${stats.total}` : "waiting for resolved cases"}
        accent
        bordered
      />
      <LearnableCell
        label="Failures to review"
        value={String(stats.failures)}
        detail="highest-signal replay set"
        warn={stats.failures > 0}
        bordered
      />
      <LearnableCell
        label="Call mix"
        value={`${stats.accum}/${stats.distrib}`}
        detail="accum / distrib"
        bordered
      />
      <div style={{ flexBasis: "100%", padding: "0 20px 12px" }}>
        <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}>
          all time · excludes neutral calls, chop outcomes, and suspect-volume markets
        </span>
      </div>
    </div>
  );
}

function LearnableCell({ label, value, detail, accent, bordered, warn, valueTitle }: {
  label: string; value: string; detail: string; accent?: boolean; bordered?: boolean; warn?: boolean;
  valueTitle?: string;
}) {
  return (
    <div style={{ flex: "1 1 170px", padding: "15px 20px", borderLeft: bordered ? "1px solid var(--border-subtle)" : undefined }}>
      <p className="kicker" style={{ margin: "0 0 5px" }}>{label}</p>
      <p title={valueTitle} style={{
        ...mono, margin: 0, fontSize: 22, lineHeight: 1, fontWeight: 500,
        color: warn ? "var(--amber)" : accent ? "var(--accent)" : "var(--text-1)",
      }}>
        {value}
      </p>
      <p style={{ ...mono, margin: "6px 0 0", fontSize: 9.5, color: "var(--text-3)" }}>{detail}</p>
    </div>
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
