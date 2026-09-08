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
import { Star, Zap, Clock, BellRing, CalendarClock } from "lucide-react";
import CandidateCard, { type PendingRow } from "../_components/CandidateCard";
import LiveChartDrawer from "../_components/LiveChartDrawer";
import { useWyckoff } from "../_components/WyckoffData";
import { daysSinceSurfaced } from "../_components/desk";
import { daysUntil } from "../_components/WatchDate";
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
  // Cards whose date has arrived (or passed). The whole reason for setting a
  // date is that you should not have to remember it.
  const due = watching.filter((r) => {
    const n = daysUntil(r.watchDate);
    return n != null && n <= 0;
  });

  /* Lane order, most-decidable first:
       1. a level you set that got touched  — changed on its own since you looked
       2. a date that has arrived           — you already decided this was the day
       3. nearest upcoming date             — what is coming, in order
       4. everything undated                — no claim on today
     Undated cards are not demoted for being undated; they simply have nothing
     to sort on, so they follow the ones that do. */
  const order = (a: PendingRow, b: PendingRow) => {
    const hit = (b.alertHitAt ? 1 : 0) - (a.alertHitAt ? 1 : 0);
    if (hit !== 0) return hit;
    const da = daysUntil(a.watchDate);
    const dbb = daysUntil(b.watchDate);
    if (da == null && dbb == null) return 0;
    if (da == null) return 1;
    if (dbb == null) return -1;
    return da - dbb;
  };

  return (
    <>
      {error && <ErrorCard message={error} />}

      <SectionHeader
        icon={<Star size={13} strokeWidth={2} />}
        title="Watching"
        count={watching.length}
        note="your triage · protected from the sweep · alerts fire in the nightly digest"
        right={
          due.length > 0 || hits.length > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              {due.length > 0 && (
                <span style={{
                  ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5,
                  padding: "4px 10px", borderRadius: 999,
                  border: "1px solid var(--amber-border)", color: "var(--amber)",
                }}>
                  <CalendarClock size={12} strokeWidth={2} />
                  {due.length} due
                </span>
              )}
              {hits.length > 0 && <HitsChip n={hits.length} />}
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

/** Alert levels that fired since you last looked. */
function HitsChip({ n }: { n: number }) {
  return (
    <span style={{
      ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5,
      padding: "4px 10px", borderRadius: 999,
      border: "1px solid var(--accent)", color: "var(--accent)",
    }}>
      <BellRing size={12} strokeWidth={2} />
      {n} level{n === 1 ? "" : "s"} touched
    </span>
  );
}
