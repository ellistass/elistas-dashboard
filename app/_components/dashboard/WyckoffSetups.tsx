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

import Link from "next/link";
import { Frame, ArrowRight, AlertTriangle, BellRing } from "lucide-react";
import { rankCandidates, GradeChip, ReasonChip, type CandidateGroup, groupByInstrument } from "@/app/wyckoff/_components/desk";
import type { PendingRow } from "@/app/wyckoff/_components/CandidateCard";
import { SUSPECT_VOLUME, instrumentName } from "@/lib/wyckoff/basket";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const px = (v: number, ref: number) => v.toFixed(ref < 10 ? 4 : 2);
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
}: {
  candidates: PendingRow[];
  lastScanAt: string | null;
  loading?: boolean;
}) {
  const ranked = rankCandidates(candidates ?? []);
  const top = ranked.slice(0, 3);
  const groups = groupByInstrument(ranked);
  const repeats = groups.filter((g) => g.rows.length > 1);
  const stale = tradingDaysSince(lastScanAt);

  return (
    <div className="card" style={{ padding: "15px 18px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 13 }}>
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
        <Link
          href="/wyckoff"
          style={{
            marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 12, fontWeight: 600, fontFamily: "'Sora', sans-serif",
            color: "var(--accent)", textDecoration: "none",
          }}
        >
          See more{ranked.length > top.length ? ` · ${ranked.length}` : ""}
          <ArrowRight size={13} strokeWidth={2} />
        </Link>
      </div>

      {loading ? (
        <p style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: 0 }}>loading the board…</p>
      ) : top.length === 0 ? (
        <p style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: 0, lineHeight: 1.6 }}>
          Nothing at a decision point. A quiet day is the normal state — the daily scan
          repopulates this after each close.
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 9 }}>
            {top.map((r, i) => <SetupTile key={r.id} row={r} best={i === 0} />)}
          </div>
          {repeats.length > 0 && <RepeatNote groups={repeats} />}
        </>
      )}
    </div>
  );
}

function SetupTile({ row, best }: { row: PendingRow; best?: boolean }) {
  const suspect = SUSPECT_VOLUME.has(row.instrument);
  const name = instrumentName(row.instrument);
  const hit = row.alertHitAt != null;
  return (
    <Link
      href="/wyckoff"
      style={{
        display: "block", textDecoration: "none", padding: "11px 12px", borderRadius: 10,
        border: `1px solid ${hit ? "var(--accent)" : best ? "var(--border-strong)" : "var(--border-subtle)"}`,
        background: best ? "var(--bg-card-2, transparent)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
        <span style={{ ...mono, fontSize: 14, fontWeight: 500, color: "var(--text-1)", letterSpacing: "0.02em" }}>
          {row.instrument}
        </span>
        {name !== row.instrument && (
          <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 300 }}>{name}</span>
        )}
        {suspect && <AlertTriangle size={10} strokeWidth={2} style={{ color: "var(--amber)" }} />}
        {hit && <BellRing size={11} strokeWidth={2} style={{ color: "var(--accent)", marginLeft: "auto" }} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <GradeChip grade={row.grade} score={row.gradeScore} />
        <ReasonChip reason={row.surfacedReason} />
      </div>

      <div style={{ ...mono, fontSize: 10.5, color: "var(--text-2)" }}>
        {px(row.rangeLo, row.rangeHi)} – {px(row.rangeHi, row.rangeHi)}
        <span style={{ color: "var(--text-3)" }}> · {row.barsInRange} bars</span>
      </div>
      <div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginTop: 4 }}>
        {row.status === "open" ? "open" : `broke ${day(row.breakoutDate)}`}
        {row.terminalTest !== "none" && ` · ${row.terminalTest}`}
        {row.traderVerdict && ` · read locked`}
        {(row.sightingCount ?? 0) > 1 && ` · seen ${row.sightingCount}×`}
      </div>
    </Link>
  );
}

/** The same pair offering several setups at once is one instrument asking
 *  repeatedly, not several opportunities — and it is worth saying on the page
 *  you look at first, before the desk has a chance to make them look separate. */
function RepeatNote({ groups }: { groups: CandidateGroup[] }) {
  return (
    <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "11px 0 0", lineHeight: 1.6 }}>
      Repeating:{" "}
      {groups.map((g, i) => (
        <span key={g.instrument}>
          {i > 0 && " · "}
          <span style={{ color: "var(--text-2)" }}>{g.instrument}</span> {g.rows.length} setups
          {g.firstSeen && <span> since {g.firstSeen}</span>}
        </span>
      ))}
    </p>
  );
}
