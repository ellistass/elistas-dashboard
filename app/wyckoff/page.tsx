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
import { Lock, Layers } from "lucide-react";
import CandidateCard from "./_components/CandidateCard";
import LiveChartDrawer from "./_components/LiveChartDrawer";
import { useWyckoff } from "./_components/WyckoffData";
import { rankCandidates, isDimmed, daysSinceSurfaced } from "./_components/desk";
import { stackCandidates, type Stack } from "@/lib/wyckoff/stack";
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

  // Areas being pressed more than once. Not "duplicates to tidy" — a box price
  // keeps returning to is the signal — but the desk should say so rather than
  // scatter the boxes across a grid sorted by grade.
  const repeats = stackCandidates(ranked as any).filter((st) => st.stacked).length;

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

      {(trackedOpen > 0 || awaitingBackfill > 0 || ageing > 0 || repeats > 0) && (
        <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "0 0 12px", lineHeight: 1.6 }}>
          {ageing > 0 && (
            <span style={{ color: "var(--amber)" }}>
              {ageing} setup{ageing === 1 ? " has" : "s have"} been here a week or more — decide or park {ageing === 1 ? "it" : "them"}.{" "}
            </span>
          )}
          {repeats > 0 && (
            <span>
              {repeats} pair{repeats === 1 ? "" : "s"} {repeats === 1 ? "is" : "are"} pressing the same area more than
              once — stacked below, open one to see the pile.{" "}
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

/* One card per STACK, not per row.
   Two overlapping boxes on a pair are one area being pressed twice, so the
   desk fronts the most decidable of them and says how deep the pile is. The
   others are not hidden — they are one click away in the drawer, drawn to
   scale against each other, which is the only place the overlap is actually
   legible. Scattering them across the grid as peers was the thing that made
   repetition look like clutter instead of pressure. */
function Grid({ rows, onChart, onChanged, dim }: {
  rows: Array<React.ComponentProps<typeof CandidateCard>["row"]>;
  onChart: (id: string) => void;
  onChanged: () => void;
  dim?: boolean;
}) {
  if (rows.length === 0) return null;
  const stacks = stackCandidates(rows as any) as Array<Stack<(typeof rows)[number]>>;
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
        gap: 12, marginBottom: 24, opacity: dim ? 0.62 : 1,
      }}
    >
      {stacks.map((st) => (
        <StackedCard
          key={st.front.id}
          stack={st}
          onChart={onChart}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

/* The pile, as one card. The depth is drawn behind the front card rather than
   written next to it — a stack should look like a stack, and the count means
   more when you can see it. */
function StackedCard({ stack, onChart, onChanged }: {
  stack: Stack<React.ComponentProps<typeof CandidateCard>["row"]>;
  onChart: (id: string) => void;
  onChanged: () => void;
}) {
  const depth = stack.rows.length;
  if (!stack.stacked) {
    return (
      <CandidateCard
        row={stack.front}
        onLocked={onChanged}
        onChart={onChart}
        onWatchChange={onChanged}
      />
    );
  }
  return (
    <div style={{ position: "relative" }}>
      {/* Sheets peeking out behind, one per extra box, capped so a deep pile
          does not turn into a fan. */}
      {Array.from({ length: Math.min(depth - 1, 3) }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            position: "absolute", left: (i + 1) * 4, right: -((i + 1) * 4),
            top: -((i + 1) * 4), height: 18,
            borderRadius: "12px 12px 0 0",
            border: "1px solid var(--border-subtle)", borderBottom: "none",
            background: "var(--bg-base)", zIndex: -1,
            opacity: 1 - i * 0.25,
          }}
        />
      ))}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => onChart(stack.front.id)}
          title={`${depth} overlapping boxes on ${stack.instrument} — open to see the pile drawn to scale`}
          style={{
            position: "absolute", top: -11, right: 10, zIndex: 2,
            fontFamily: "'DM Mono', monospace", fontSize: 9.5,
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 9px", borderRadius: 999, cursor: "pointer",
            border: "1px solid var(--accent)", background: "var(--bg-base)",
            color: "var(--accent)",
          }}
        >
          <Layers size={10} strokeWidth={2} />
          {depth} boxes
          {stack.firstSeen && <span style={{ color: "var(--text-3)" }}>since {stack.firstSeen}</span>}
        </button>
        <CandidateCard
          row={stack.front}
          onLocked={onChanged}
          onChart={onChart}
          onWatchChange={onChanged}
        />
      </div>
    </div>
  );
}
