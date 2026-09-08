"use client";
// app/_components/dashboard/WyckoffSetups.tsx — Wyckoff at the top of the day.
//
// Wyckoff is the strategy now, so it opens the dashboard rather than sitting
// four items down the sidebar behind a currency-strength read. What goes here
// is deliberately NOT the desk: the desk is where you work through everything,
// and reproducing it on the home page would just be the same triage twice.
// This is the answer to one question — what is the best setup on the board
// this morning — plus a door to the rest.
//
// A+ means the top of the ranking the desk already uses: an alert you set that
// got touched, then urgency (a test that printed beats a range already gone),
// then structural grade. The card is a summary, not a read: to actually read
// one you go to the desk, because the read form belongs where the chart is.

import { useState } from "react";
import Link from "next/link";
import { Frame, ArrowRight, AlertTriangle } from "lucide-react";
import { rankCandidates } from "@/app/wyckoff/_components/desk";
import { stackCandidates, type Stack } from "@/lib/wyckoff/stack";
import CandidateCard, { type PendingRow } from "@/app/wyckoff/_components/CandidateCard";
import LiveChartDrawer from "@/app/wyckoff/_components/LiveChartDrawer";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

/** Trading-day staleness, weekends excluded — a Saturday reading of Friday's
 *  close is current, and an amber badge every weekend teaches you to ignore it. */
function tradingDaysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;
  const now = new Date();
  let days = 0;
  const cur = new Date(then);
  while (cur < now) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) days++;
  }
  return Math.max(0, days - 1);
}

export function WyckoffSetups({
  candidates,
  lastScanAt,
  loading,
  onChanged,
}: {
  candidates: PendingRow[];
  lastScanAt: string | null;
  loading?: boolean;
  onChanged?: () => void;
}) {
  const [chartId, setChartId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const ranked = rankCandidates(candidates ?? []);
  // One card by default. It is the A+ setup — the whole claim of this section
  // is that there is a best one, and showing three side by side quietly walks
  // that back into a shortlist you still have to choose from.
  const shown = expanded ? ranked.slice(0, 6) : ranked.slice(0, 1);
  // Same reading as the desk: a pair pressing one area repeatedly, not a pair
  // with several unrelated setups.
  const repeats = stackCandidates(ranked as any).filter((st) => st.stacked);
  const stale = tradingDaysSince(lastScanAt);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 11 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--text-1)" }}>
          <Frame size={14} strokeWidth={2} />
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>A+ setup</span>
        </span>
        <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
          Wyckoff · ranked by urgency, then grade
        </span>
        {stale != null && stale >= 2 && (
          <span
            title={`the scanner last wrote ${day(lastScanAt)}`}
            style={{
              ...mono, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10,
              padding: "3px 9px", borderRadius: 999,
              border: "1px solid var(--amber-border)", color: "var(--amber)",
            }}
          >
            <AlertTriangle size={10} strokeWidth={2} />
            {stale}d old
          </span>
        )}

        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12 }}>
          {/* "See more" shows more setups, right here. It used to be a link to
              /wyckoff, which is a different thing: going somewhere else to look
              is not seeing more. The link to the full desk is still there, but
              it is now clearly the other option rather than the only one. */}
          {ranked.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: 0,
                border: "none", background: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600, fontFamily: "'Sora', sans-serif",
                color: "var(--accent)",
              }}
            >
              {expanded ? "Show less" : `See more · ${ranked.length - 1}`}
              <ArrowRight
                size={13}
                strokeWidth={2}
                style={{ transform: expanded ? "rotate(-90deg)" : undefined, transition: "transform 0.15s" }}
              />
            </button>
          )}
          <Link
            href="/wyckoff"
            style={{
              fontSize: 12, fontFamily: "'Sora', sans-serif",
              color: "var(--text-3)", textDecoration: "none",
            }}
          >
            Full desk
          </Link>
        </span>
      </div>

      {loading ? (
        <p style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: 0 }}>loading the board…</p>
      ) : shown.length === 0 ? (
        <p style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: 0, lineHeight: 1.6 }}>
          Nothing at a decision point. A quiet day is the normal state — the daily scan
          repopulates this after each close.
        </p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: expanded ? "repeat(auto-fill, minmax(330px, 1fr))" : "1fr",
              gap: 12,
            }}
          >
            {shown.map((row) => (
              <CandidateCard
                key={row.id}
                row={row}
                onLocked={() => onChanged?.()}
                onChart={setChartId}
                onWatchChange={() => onChanged?.()}
              />
            ))}
          </div>
          {repeats.length > 0 && <RepeatNote groups={repeats} />}
        </>
      )}

      {chartId && (
        <LiveChartDrawer id={chartId} onClose={() => setChartId(null)} onChanged={() => onChanged?.()} />
      )}
    </div>
  );
}

/** The same pair offering several setups at once is one instrument asking
 *  repeatedly, not several opportunities — and it is worth saying on the page
 *  you look at first, before the desk has a chance to make them look separate. */
function RepeatNote({ groups }: { groups: Array<Stack<any>> }) {
  return (
    <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "11px 0 0", lineHeight: 1.6 }}>
      Pressing the same area:{" "}
      {groups.map((g, i) => (
        <span key={g.instrument}>
          {i > 0 && " · "}
          <span style={{ color: "var(--text-2)" }}>{g.instrument}</span> {g.rows.length} boxes
          {g.firstSeen && <span> since {g.firstSeen}</span>}
        </span>
      ))}
    </p>
  );
}
