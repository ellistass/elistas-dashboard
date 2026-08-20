"use client";
// app/wyckoff/watching/page.tsx — the queue you triaged.
//
// Two lanes, one job: separate what you want in front of you TODAY from what
// you will come back to. Neither is a call on direction — the read is still the
// only thing that scores. Rows here survive the stale-open sweep and keep their
// note, so returning a week later does not mean starting cold.
//
// This is also where the "I saw it at the test and then it went without me"
// failure shows up first: a Later card that has been sitting for three weeks
// with a touched alert is a move that happened next to you.

import { useState } from "react";
import { Star, Zap, Clock, BellRing } from "lucide-react";
import CandidateCard, { type PendingRow } from "../_components/CandidateCard";
import LiveChartDrawer from "../_components/LiveChartDrawer";
import { useWyckoff } from "../_components/WyckoffData";
import { daysSinceSurfaced } from "../_components/desk";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../_components/ui";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

const LANES = [
  { key: "now", label: "Now", icon: <Zap size={12} strokeWidth={2} />, note: "immediate — read these first" },
  { key: "later", label: "Later", icon: <Clock size={12} strokeWidth={2} />, note: "parked — come back to these" },
] as const;

export default function WatchingPage() {
  const { watching, loading, error, reload } = useWyckoff();
  const [chartId, setChartId] = useState<string | null>(null);

  if (loading) return <LoadingCard what="watchlist" />;

  const hits = watching.filter((r) => r.alertHitAt != null);
  // Touched levels float to the top of their lane — the one thing here that
  // changed on its own since you last looked.
  const order = (a: PendingRow, b: PendingRow) => (b.alertHitAt ? 1 : 0) - (a.alertHitAt ? 1 : 0);

  return (
    <>
      {error && <ErrorCard message={error} />}

      <SectionHeader
        icon={<Star size={13} strokeWidth={2} />}
        title="Watching"
        count={watching.length}
        note="your triage · protected from the sweep · alerts fire in the nightly digest"
        right={
          hits.length > 0 ? (
            <span style={{
              ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5,
              padding: "4px 10px", borderRadius: 999,
              border: "1px solid var(--accent)", color: "var(--accent)",
            }}>
              <BellRing size={12} strokeWidth={2} />
              {hits.length} level{hits.length === 1 ? "" : "s"} touched
            </span>
          ) : undefined
        }
      />

      {watching.length === 0 ? (
        <EmptyState text="Nothing triaged yet. Tag a candidate Now or Later on the desk and it moves here, where it survives the stale-open sweep instead of quietly scrolling away." />
      ) : (
        LANES.map((lane) => {
          const rows = watching.filter((r) => r.watch === lane.key).sort(order);
          if (!rows.length) return null;
          const stale = rows.filter((r) => (daysSinceSurfaced(r) ?? 0) >= 14).length;
          return (
            <div key={lane.key} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 9px", flexWrap: "wrap" }}>
                <span style={{
                  ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  color: lane.key === "now" ? "var(--accent)" : "var(--text-2)",
                }}>
                  {lane.icon} {lane.label} · {rows.length}
                </span>
                <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{lane.note}</span>
                {stale > 0 && (
                  <span style={{ ...mono, fontSize: 10, color: "var(--amber)" }}>
                    {stale} sitting 2+ weeks
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
                {rows.map((row) => (
                  <CandidateCard
                    key={row.id}
                    row={row}
                    onLocked={reload}
                    onChart={setChartId}
                    onWatchChange={reload}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      {chartId && <LiveChartDrawer id={chartId} onClose={() => setChartId(null)} onChanged={reload} />}
    </>
  );
}
