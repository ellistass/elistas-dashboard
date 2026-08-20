"use client";
// app/wyckoff/archive/page.tsx — the monthly audit.
//
// The month is the unit of review, so it is the default view rather than an
// option buried in a period dropdown. Landing here shows the current month with
// its audit band already computed: how many setups resolved, how you scored
// against the engine on them, the grade mix, and how much warning the scanner
// actually gave. Stepping back a month is one click.
//
// Every date the scanner records is a sortable column — range start, surfaced,
// breakout — because "when did 6E last do this" should be a glance, not a
// scroll. `all time` is still there for the times you genuinely want the whole
// history, but it is no longer what you get by default.

import { useState } from "react";
import { Eye, AlertTriangle, PlaySquare, ChevronLeft, ChevronRight } from "lucide-react";
import ReviewDrawer from "../_components/ReviewDrawer";
import { useWyckoff, type ResolvedRow } from "../_components/WyckoffData";
import { GradeChip } from "../_components/desk";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../_components/ui";
import { summariseLeads } from "@/lib/wyckoff/timing";
import { isLearnableCase } from "@/lib/wyckoff/learnable";
import { SUSPECT_VOLUME, instrumentName } from "@/lib/wyckoff/basket";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

const VERDICT_COLOR: Record<string, string> = {
  accum: "var(--green)", distrib: "var(--red)", pass: "var(--text-3)", neutral: "var(--text-3)",
};
const OUTCOME_COLOR: Record<string, string> = { up: "var(--green)", down: "var(--red)", chop: "var(--text-3)" };
const verdictLabel = (v: string) =>
  v === "accum" ? "ACCUM" : v === "distrib" ? "DISTRIB" : v === "pass" ? "PASS" : "NEUTRAL";
const verdictHits = (v: string, outcome: string) =>
  v === "accum" ? outcome === "up" : v === "distrib" ? outcome === "down" : outcome === "chop";

const FILTERS = ["learnable", "failures", "successes", "everything"] as const;
type Filter = (typeof FILTERS)[number];
type SortKey = "outcomeAt" | "rangeStartDate" | "surfacedBarDate" | "breakoutDate" | "leadToBreakout" | "gradeScore";
/** Which date the month filter reads. "Happened" is when the setup broke out;
 *  "reviewed" is when its outcome resolved — the same case falls in different
 *  months under each, and the audit means different things depending which you
 *  pick, so it is an explicit choice rather than a hidden assumption. */
type Anchor = "breakoutDate" | "outcomeAt";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthKey(offset: number): { y: number; m: number; label: string } {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}

export default function ArchivePage() {
  const { resolved, loading, error } = useWyckoff();
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("everything");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);        // 0 = this month
  const [allTime, setAllTime] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>("breakoutDate");
  const [sort, setSort] = useState<SortKey>("breakoutDate");
  const [asc, setAsc] = useState(false);

  if (loading) return <LoadingCard what="archive" />;

  const { y, m, label } = monthKey(offset);
  const inMonth = (r: ResolvedRow) => {
    if (allTime) return true;
    const raw = anchor === "breakoutDate" ? r.breakoutDate : r.outcomeAt;
    if (!raw) return false;
    const d = new Date(raw);
    return d.getUTCFullYear() === y && d.getUTCMonth() === m;
  };

  // The month's cases BEFORE the learnable/failures filter — the audit band
  // describes the month, not the current tab.
  const monthRows = resolved.filter(inMonth);

  const matches = (r: ResolvedRow, f: Filter) =>
    f === "everything" ? true :
    f === "learnable" ? isLearnableCase(r) :
    f === "failures" ? isLearnableCase(r) && !verdictHits(r.engineVerdict, r.outcome) :
    isLearnableCase(r) && verdictHits(r.engineVerdict, r.outcome);

  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, monthRows.filter((r) => matches(r, f)).length]),
  ) as Record<Filter, number>;

  const q = search.trim().toUpperCase();
  const rows = monthRows
    .filter((r) => matches(r, filter) && (!q || r.instrument.toUpperCase().includes(q)))
    .sort((a, b) => {
      const va = pick(a, sort);
      const vb = pick(b, sort);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // nulls last in both directions
      if (vb == null) return -1;
      return asc ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
    });

  const toggleSort = (k: SortKey) => {
    if (k === sort) setAsc((v) => !v);
    else { setSort(k); setAsc(false); }
  };

  return (
    <>
      {error && <ErrorCard message={error} />}

      <SectionHeader
        icon={<Eye size={13} strokeWidth={2} />}
        title={allTime ? "Archive — all time" : `Audit — ${label}`}
        count={rows.length}
        total={monthRows.length}
        note="your read vs engine vs what price did"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <NavBtn onClick={() => { setAllTime(false); setOffset((o) => o + 1); }} label="previous month">
                <ChevronLeft size={13} strokeWidth={2} />
              </NavBtn>
              <span style={{ ...mono, fontSize: 11, minWidth: 74, textAlign: "center", color: allTime ? "var(--text-3)" : "var(--text-1)" }}>
                {allTime ? "—" : label}
              </span>
              <NavBtn
                onClick={() => { setAllTime(false); setOffset((o) => Math.max(0, o - 1)); }}
                label="next month"
                disabled={!allTime && offset === 0}
              >
                <ChevronRight size={13} strokeWidth={2} />
              </NavBtn>
            </div>
            <button
              type="button"
              onClick={() => setAllTime((v) => !v)}
              style={{
                ...mono, fontSize: 10.5, padding: "6px 11px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${allTime ? "var(--accent)" : "var(--border-strong)"}`,
                background: "transparent", color: allTime ? "var(--accent)" : "var(--text-3)",
              }}
            >
              all time
            </button>
            <div className="seg">
              <button type="button" className={anchor === "breakoutDate" ? "on" : ""} onClick={() => setAnchor("breakoutDate")}>
                happened
              </button>
              <button type="button" className={anchor === "outcomeAt" ? "on" : ""} onClick={() => setAnchor("outcomeAt")}>
                resolved
              </button>
            </div>
          </div>
        }
      />

      <AuditBand label={allTime ? "all time" : label} rows={monthRows} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter instrument…"
          style={{
            ...mono, fontSize: 11, width: 140, padding: "7px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-1)", outline: "none",
          }}
        />
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {(f === "learnable" ? "Learnable" : f === "failures" ? "Failures" : f === "successes" ? "Successes" : "Everything") + ` ${counts[f]}`}
            </button>
          ))}
        </div>
      </div>

      {monthRows.length === 0 ? (
        <EmptyState
          small
          text={
            allTime
              ? "Nothing resolved yet — outcomes backfill 12 trading days after each breakout."
              : `No setups ${anchor === "breakoutDate" ? "broke out" : "resolved"} in ${label}. Step back a month, or switch to all time.`
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState small text={q ? `No ${filter} cases match "${search.trim()}" in ${label}.` : `Nothing in ${filter} for ${label}.`} />
      ) : (
        <Table rows={rows} sort={sort} asc={asc} onSort={toggleSort} onReview={setReviewId} />
      )}

      {reviewId && <ReviewDrawer id={reviewId} onClose={() => setReviewId(null)} />}
    </>
  );
}

/* ── The audit band ────────────────────────────────────────────────────────
   What a monthly review actually needs on one line: volume, how you did
   against the engine on the shared set, what quality of setup the scanner
   produced, and how much warning it gave. */
function AuditBand({ label, rows }: { label: string; rows: ResolvedRow[] }) {
  const withRead = rows.filter((r) => r.traderVerdict && r.loggedBlind);
  const youHits = withRead.filter((r) => verdictHits(r.traderVerdict!, r.outcome)).length;
  const engHits = withRead.filter((r) => verdictHits(r.engineVerdict, r.outcome)).length;
  const leads = summariseLeads(rows.map((r) => r.leadToBreakout ?? null));
  const grades = ["A", "B", "C", "D"].map((g) => ({ g, n: rows.filter((r) => r.grade === g).length }));
  const graded = grades.reduce((s, x) => s + x.n, 0);
  const dirn = rows.filter((r) => r.outcome === "up" || r.outcome === "down").length;

  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 0, padding: 0, marginBottom: 16, overflow: "hidden" }}>
      <Cell label="Resolved" value={String(rows.length)} detail={`${dirn} directional · ${rows.length - dirn} chop`} />
      <Cell
        label="You vs engine"
        value={withRead.length ? `${Math.round((youHits / withRead.length) * 100)}% / ${Math.round((engHits / withRead.length) * 100)}%` : "—"}
        detail={withRead.length ? `${youHits} vs ${engHits} of ${withRead.length} blind reads` : "no blind reads this period"}
        accent
        bordered
      />
      <Cell
        label="Setup quality"
        value={graded ? `${grades[0].n + grades[1].n}/${graded}` : "—"}
        detail={graded ? `A ${grades[0].n} · B ${grades[1].n} · C ${grades[2].n} · D ${grades[3].n}` : "not graded yet"}
        bordered
      />
      <Cell
        label="Scanner lead"
        value={leads.median == null ? "—" : `${leads.median > 0 ? "+" : ""}${leads.median}`}
        detail={leads.latePct == null ? "no timing data yet" : `median bars · ${leads.latePct}% late`}
        warn={leads.latePct != null && leads.latePct > 40}
        bordered
      />
      <div style={{ flexBasis: "100%", padding: "0 20px 12px" }}>
        <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}>
          {label} · every figure here describes this period only, not the running totals in the header
        </span>
      </div>
    </div>
  );
}

function Cell({ label, value, detail, accent, bordered, warn }: {
  label: string; value: string; detail: string; accent?: boolean; bordered?: boolean; warn?: boolean;
}) {
  return (
    <div style={{ flex: "1 1 175px", padding: "15px 20px", borderLeft: bordered ? "1px solid var(--border-subtle)" : undefined }}>
      <p className="kicker" style={{ margin: "0 0 5px" }}>{label}</p>
      <p style={{
        ...mono, margin: 0, fontSize: 20, lineHeight: 1, fontWeight: 500,
        color: warn ? "var(--amber)" : accent ? "var(--accent)" : "var(--text-1)",
      }}>
        {value}
      </p>
      <p style={{ ...mono, margin: "6px 0 0", fontSize: 9.5, color: "var(--text-3)" }}>{detail}</p>
    </div>
  );
}

function NavBtn({ children, onClick, label, disabled }: {
  children: React.ReactNode; onClick: () => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, borderRadius: 7, cursor: disabled ? "default" : "pointer",
        border: "1px solid var(--border-strong)", background: "transparent",
        color: disabled ? "var(--text-3)" : "var(--text-1)", opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function pick(r: ResolvedRow, k: SortKey): string | number | null {
  switch (k) {
    case "outcomeAt": return r.outcomeAt ?? null;
    case "rangeStartDate": return r.rangeStartDate ?? null;
    case "surfacedBarDate": return (r as any).surfacedBarDate ?? null;
    case "breakoutDate": return r.breakoutDate ?? null;
    case "leadToBreakout": return r.leadToBreakout ?? null;
    case "gradeScore": return r.gradeScore ?? null;
  }
}

function Table({ rows, sort, asc, onSort, onReview }: {
  rows: ResolvedRow[]; sort: SortKey; asc: boolean;
  onSort: (k: SortKey) => void; onReview: (id: string) => void;
}) {
  const th: React.CSSProperties = {
    ...mono, textAlign: "left", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
    color: "var(--text-3)", fontWeight: 500, padding: "10px 11px",
    borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { ...mono, padding: "9px 11px", color: "var(--text-2)", whiteSpace: "nowrap" };
  const sortable = (k: SortKey, label: string, align: "left" | "right" = "left") => (
    <th
      style={{ ...th, textAlign: align, cursor: "pointer", color: sort === k ? "var(--accent)" : th.color }}
      onClick={() => onSort(k)}
      title="click to sort"
    >
      {label}{sort === k ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 30 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>Instrument</th>
            {sortable("gradeScore", "Grade")}
            {sortable("rangeStartDate", "Range start")}
            {sortable("surfacedBarDate", "Surfaced")}
            {sortable("breakoutDate", "Broke out")}
            {sortable("leadToBreakout", "Lead", "right")}
            <th style={th}>Outcome</th>
            <th style={th}>Your read</th>
            <th style={th}>Engine</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onReview(r.id)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-card-2, var(--border-subtle))")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{ borderBottom: "1px solid var(--border-faint, var(--border-subtle))", transition: "background 0.1s", cursor: "pointer" }}
            >
              <td style={{ ...td, color: "var(--text-1)", fontWeight: 500 }}>
                {r.instrument}
                {SUSPECT_VOLUME.has(r.instrument) && (
                  <AlertTriangle size={11} strokeWidth={2} style={{ color: "var(--amber)", marginLeft: 5, verticalAlign: "-1px" }} />
                )}
                {instrumentName(r.instrument) !== r.instrument && (
                  <span style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 400, marginLeft: 6 }}>
                    {instrumentName(r.instrument)}
                  </span>
                )}
              </td>
              <td style={td}><GradeChip grade={r.grade} score={r.gradeScore} /></td>
              <td style={td}>{day(r.rangeStartDate)}</td>
              <td style={{ ...td, color: (r as any).surfacedBarDate ? "var(--text-2)" : "var(--text-3)" }}>
                {day((r as any).surfacedBarDate)}
              </td>
              <td style={td}>{day(r.breakoutDate)}</td>
              <LeadCell bars={r.leadToBreakout} />
              <td style={{ ...td, color: OUTCOME_COLOR[r.outcome] ?? "var(--text-2)", fontWeight: 500 }}>
                {r.outcome.toUpperCase()}
              </td>
              <VerdictCell verdict={r.traderVerdict} outcome={r.outcome} />
              <VerdictCell verdict={r.engineVerdict} outcome={r.outcome} />
              <td style={{ padding: "7px 11px" }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px",
                  borderRadius: 7, fontSize: 11, fontWeight: 600, fontFamily: "'Sora', sans-serif",
                  color: "var(--text-1)", border: "1px solid var(--border-strong)",
                }}>
                  <PlaySquare size={12} strokeWidth={2} />
                  Review
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bars of warning before the breakout. Zero or negative means the scanner
 *  surfaced it at or after the move — reading it was never a live decision. */
function LeadCell({ bars }: { bars?: number | null }) {
  const td: React.CSSProperties = { ...mono, padding: "9px 11px", textAlign: "right", whiteSpace: "nowrap" };
  if (bars == null) return <td style={{ ...td, color: "var(--text-3)" }}>—</td>;
  const late = bars <= 0;
  return (
    <td style={{ ...td, color: late ? "var(--amber)" : "var(--text-2)" }} title={late ? "surfaced at or after the breakout" : `${bars} bars of warning`}>
      {bars > 0 ? `+${bars}` : bars}
    </td>
  );
}

function VerdictCell({ verdict, outcome }: { verdict: string | null; outcome: string }) {
  if (!verdict) return <td style={{ ...mono, padding: "9px 11px", color: "var(--text-3)" }}>—</td>;
  const hit = verdictHits(verdict, outcome);
  return (
    <td style={{ ...mono, padding: "9px 11px", color: VERDICT_COLOR[verdict] ?? "var(--text-2)", whiteSpace: "nowrap" }}>
      {verdictLabel(verdict)}{" "}
      <span style={{ color: hit ? "var(--green)" : "var(--red)" }}>{hit ? "✓" : "✗"}</span>
    </td>
  );
}
