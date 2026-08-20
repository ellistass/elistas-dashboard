"use client";
// app/wyckoff/page.tsx — THE DESK. One job: what needs deciding today.
//
// Everything that is not a live decision has moved to its own route. What is
// left is a ranked grid you can empty. The ranking is the point:
//
//   1. touched alerts   — the only thing here that changed on its own
//   2. urgency band     — test just printed > pressing the edge > already broke
//   3. structural grade — quality within the band
//
// C and D grades stay, dimmed. Hiding them would mean trusting a grader with
// no track record; dimming lets you audit what it demoted for free.

import { useState } from "react";
import { Lock } from "lucide-react";
import CandidateCard from "./_components/CandidateCard";
import LiveChartDrawer from "./_components/LiveChartDrawer";
import { useWyckoff } from "./_components/WyckoffData";
import { rankCandidates, isDimmed, daysSinceSurfaced } from "./_components/desk";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "./_components/ui";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export default function DeskPage() {
  const { pending, watching, trackedOpen, awaitingBackfill, loading, error, reload } = useWyckoff();
  const [chartId, setChartId] = useState<string | null>(null);

  const ranked = rankCandidates(pending);
  const live = ranked.filter((r) => !isDimmed(r));
  const marginal = ranked.filter(isDimmed);

  // A setup that surfaced over a week ago and is still sitting here has been
  // decaying in front of you. Worth saying out loud — this is exactly the
  // "I saw it at the test and then it went without me" case.
  const ageing = ranked.filter((r) => (daysSinceSurfaced(r) ?? 0) >= 7).length;

  if (loading) return <LoadingCard what="candidates" />;

  return (
    <>
      {error && <ErrorCard message={error} />}

      <SectionHeader
        icon={<Lock size={13} strokeWidth={2} />}
        title="At a decision point"
        count={pending.length}
        note="blind · reads lock on submit · ranked by urgency, then grade"
      />

      {(trackedOpen > 0 || awaitingBackfill > 0 || ageing > 0) && (
        <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "0 0 12px", lineHeight: 1.6 }}>
          {ageing > 0 && (
            <span style={{ color: "var(--amber)" }}>
              {ageing} setup{ageing === 1 ? " has" : "s have"} been here a week or more — decide or park {ageing === 1 ? "it" : "them"}.{" "}
            </span>
          )}
          silently tracking {trackedOpen} open range{trackedOpen === 1 ? "" : "s"} mid-box · {awaitingBackfill} older
          breakout{awaitingBackfill === 1 ? "" : "s"} awaiting backfill — not readable (that read wouldn&apos;t be blind)
        </p>
      )}

      {pending.length === 0 ? (
        <EmptyState
          text={
            watching.length > 0
              ? "Desk clear — everything at a decision point is triaged into Watching. A quiet day is the normal state; the daily scan repopulates this after each close."
              : "No candidates at a decision point — a quiet day is the normal state. The daily scan repopulates this after each close."
          }
        />
      ) : (
        <>
          <Grid rows={live} onChart={setChartId} onChanged={reload} />

          {marginal.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "22px 0 11px" }}>
                <span style={{ ...mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
                  Marginal · {marginal.length}
                </span>
                <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
                  C and D grades — thin edges, no live test, or not much of a cause. Still readable.
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
              </div>
              <Grid rows={marginal} onChart={setChartId} onChanged={reload} dim />
            </>
          )}
        </>
      )}

      {chartId && (
        <LiveChartDrawer id={chartId} onClose={() => setChartId(null)} onChanged={reload} />
      )}
    </>
  );
}

function Grid({ rows, onChart, onChanged, dim }: {
  rows: Array<React.ComponentProps<typeof CandidateCard>["row"]>;
  onChart: (id: string) => void;
  onChanged: () => void;
  dim?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
        gap: 12, marginBottom: 24, opacity: dim ? 0.62 : 1,
      }}
    >
      {rows.map((row) => (
        <CandidateCard
          key={row.id}
          row={row}
          onLocked={onChanged}
          onChart={onChart}
          onWatchChange={onChanged}
        />
      ))}
    </div>
  );
}
