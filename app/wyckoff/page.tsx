"use client";
// app/wyckoff/page.tsx — Wyckoff reading desk + scorekeeper (v2 design).
//
// Composition (top to bottom):
//   1. Header — title, data state, Run scan.
//   2. ScoreStrip — the you-vs-engine benchmark as one unit + pass-rate meter.
//   3. Reading desk — fresh candidates as a card grid (read in seconds, lock).
//   4. Resolved archive — filterable reveal table + Review replay.
//
// The blind rules all live server-side; this page is presentation only.

import { useCallback, useEffect, useState } from "react";
import { Frame, Lock, Eye, RefreshCw, PlaySquare, AlertTriangle, Inbox } from "lucide-react";
import ReviewDrawer from "./_components/ReviewDrawer";
import LiveChartDrawer from "./_components/LiveChartDrawer";
import ScoreStrip, { type Scoreboard } from "./_components/ScoreStrip";
import CandidateCard, { type PendingRow } from "./_components/CandidateCard";
import { SUSPECT_VOLUME, instrumentInfo, instrumentName } from "@/lib/wyckoff/basket";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface ResolvedRow extends PendingRow {
  outcome: string;
  outcomeAt: string | null;
  engineVerdict: string;
  loggedBlind: boolean;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const px = (v: number, hi: number) => v.toFixed(hi < 10 ? 4 : 2);
const boxFmt = (r: { rangeLo: number; rangeHi: number }) => `${px(r.rangeLo, r.rangeHi)}–${px(r.rangeHi, r.rangeHi)}`;
const ctxFmt = (v: number | null) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

const VERDICT_COLOR: Record<string, string> = {
  accum: "var(--green)", distrib: "var(--red)", pass: "var(--text-3)", neutral: "var(--text-3)",
};
const OUTCOME_COLOR: Record<string, string> = { up: "var(--green)", down: "var(--red)", chop: "var(--text-3)" };
const verdictLabel = (v: string) =>
  v === "accum" ? "ACCUM" : v === "distrib" ? "DISTRIB" : v === "pass" ? "PASS" : "NEUTRAL";
const verdictHits = (v: string, outcome: string) =>
  v === "accum" ? outcome === "up" : v === "distrib" ? outcome === "down" : outcome === "chop";

/* Review learnable-set filter (addendum §2): engine committed a direction, the
   market resolved directionally, and the volume is trustworthy. */
const isLearnable = (r: { engineVerdict: string; outcome: string; instrument: string }) =>
  (r.engineVerdict === "accum" || r.engineVerdict === "distrib") &&
  (r.outcome === "up" || r.outcome === "down") &&
  !SUSPECT_VOLUME.has(r.instrument);

const REVIEW_FILTERS = ["learnable", "failures", "successes", "everything"] as const;
type ReviewFilter = (typeof REVIEW_FILTERS)[number];

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function WyckoffPage() {
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [resolved, setResolved] = useState<ResolvedRow[]>([]);
  const [score, setScore] = useState<Scoreboard | null>(null);
  const [passRate, setPassRate] = useState<{ total: number; pass: number } | null>(null);
  const [trackedOpen, setTrackedOpen] = useState(0);
  const [awaitingBackfill, setAwaitingBackfill] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("learnable");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("all"); // breakout-date window

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wyckoff", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `load failed (${res.status})`);
      setPending(j.pending);
      setResolved(j.resolved);
      setScore(j.score);
      setPassRate(j.passRate ?? null);
      setTrackedOpen(j.trackedOpen ?? 0);
      setAwaitingBackfill(j.awaitingBackfill ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runScanNow() {
    if (scanning) return;
    setScanning(true);
    setScanNote(null);
    try {
      const res = await fetch("/api/wyckoff", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.error ?? `scan failed (${res.status})`);
      setScanNote(
        `scanned ${j.scanned} · ${j.rangesFound} ranges · ${j.freshCount} fresh · ` +
        `${j.backfill?.updated ?? 0} outcomes resolved · ${j.staleRemoved ?? 0} stale opens swept · ` +
        `data through ${j.latestBarDate ?? "?"}`,
      );
      await load();
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : String(e));
    }
    setScanning(false);
  }

  // Per-tab counts computed up front — an empty tab must read as a DATA fact
  // ("engine has 0 successes yet"), never as a possibly-broken page.
  const matches = (r: ResolvedRow, f: ReviewFilter) =>
    f === "everything" ? true :
    f === "learnable" ? isLearnable(r) :
    f === "failures" ? isLearnable(r) && !verdictHits(r.engineVerdict, r.outcome) :
    isLearnable(r) && verdictHits(r.engineVerdict, r.outcome);
  const tabCounts = Object.fromEntries(
    REVIEW_FILTERS.map((f) => [f, resolved.filter((r) => matches(r, f)).length]),
  ) as Record<ReviewFilter, number>;
  const q = search.trim().toUpperCase();
  const inPeriod = (r: ResolvedRow): boolean => {
    if (period === "all" || !r.breakoutDate) return period === "all";
    const d = r.breakoutDate.slice(0, 10);
    if (period === "30d" || period === "90d") {
      const days = period === "30d" ? 30 : 90;
      return new Date(`${d}T00:00:00Z`).getTime() >= Date.now() - days * 86_400_000;
    }
    return d.startsWith(period); // "2026" | "2025" | "2024"
  };
  const filteredResolved = resolved.filter(
    (r) => matches(r, reviewFilter) && inPeriod(r) && (!q || r.instrument.toUpperCase().includes(q)),
  );

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      {/* ── 1 · Header ── */}
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap", marginBottom: 22 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>Wyckoff ranges</h1>
            <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)", paddingTop: 6 }}>
              <Frame size={13} strokeWidth={2} />
              {pending.length} to read · {resolved.length} resolved
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-label)", fontWeight: 300, maxWidth: 620 }}>
            Read the chart, lock your call before the range resolves. The engine&apos;s verdict stays
            sealed server-side until the outcome exists — then both reads are revealed together.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button
            onClick={runScanNow}
            disabled={scanning}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 15px",
              borderRadius: 9, border: "none", background: "var(--accent)", color: "var(--accent-on)",
              fontSize: 13, fontWeight: 600, cursor: scanning ? "default" : "pointer",
              boxShadow: "0 0 20px rgba(58,212,236,0.26)", opacity: scanning ? 0.6 : 1,
              fontFamily: "'Sora', sans-serif",
            }}
          >
            <RefreshCw size={15} strokeWidth={2} style={scanning ? { animation: "spin 1s linear infinite" } : undefined} />
            {scanning ? "Scanning… (~1 min)" : "Run scan"}
          </button>
          {scanNote && (
            <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", maxWidth: 340, textAlign: "right" }}>{scanNote}</span>
          )}
        </div>
      </header>

      {/* ── 2 · Benchmark ── */}
      {score && <ScoreStrip score={score} passRate={passRate} />}

      {error && (
        <div className="card" style={{ padding: 16, marginBottom: 14, border: "1px solid var(--red-border)" }}>
          <span style={{ ...mono, fontSize: 12, color: "var(--red)" }}>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <p style={{ ...mono, fontSize: 12, color: "var(--text-3)", margin: 0 }}>Loading candidates…</p>
        </div>
      ) : (
        <>
          {/* ── 3 · Reading desk ── */}
          <SectionHeader
            icon={<Lock size={13} strokeWidth={2} />}
            title="At a decision point"
            count={pending.length}
            note="blind · fresh candidates only · reads lock on submit"
          />
          {(trackedOpen > 0 || awaitingBackfill > 0) && (
            <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "0 0 12px" }}>
              silently tracking {trackedOpen} open range{trackedOpen === 1 ? "" : "s"} mid-box · {awaitingBackfill} older
              breakout{awaitingBackfill === 1 ? "" : "s"} awaiting backfill — not readable (that read wouldn&apos;t be blind)
            </p>
          )}
          {pending.length === 0 ? (
            <EmptyState
              text="No candidates at a decision point — a quiet day is the normal state. The daily scan repopulates this after each close."
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12, marginBottom: 30 }}>
              {pending.map((row) => (
                <CandidateCard key={row.id} row={row} onLocked={load} onChart={setChartId} />
              ))}
            </div>
          )}

          {/* ── 4 · Resolved archive ── */}
          <SectionHeader
            icon={<Eye size={13} strokeWidth={2} />}
            title="Resolved — revealed"
            count={filteredResolved.length}
            total={resolved.length}
            note="your read vs engine vs what price did"
            right={
              resolved.length > 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="filter instrument…"
                    style={{
                      ...mono, fontSize: 11, width: 130, padding: "7px 10px",
                      borderRadius: 8, border: "1px solid var(--border)",
                      background: "transparent", color: "var(--text-1)", outline: "none",
                    }}
                  />
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    style={{
                      ...mono, fontSize: 11, padding: "7px 9px", borderRadius: 8,
                      border: "1px solid var(--border)", background: "var(--bg-card, transparent)",
                      color: "var(--text-1)", outline: "none", cursor: "pointer",
                    }}
                  >
                    <option value="all">all time</option>
                    <option value="30d">broke out ≤ 30d</option>
                    <option value="90d">broke out ≤ 90d</option>
                    <option value="2026">2026</option>
                    <option value="2025">2025</option>
                    <option value="2024">2024</option>
                  </select>
                  <div className="seg">
                    {REVIEW_FILTERS.map((f) => (
                      <button key={f} className={reviewFilter === f ? "on" : ""} onClick={() => setReviewFilter(f)}>
                        {(f === "learnable" ? "Learnable" : f === "failures" ? "Failures" : f === "successes" ? "Successes" : "Everything") +
                          ` ${tabCounts[f]}`}
                      </button>
                    ))}
                  </div>
                </div>
              ) : undefined
            }
          />
          {resolved.length === 0 ? (
            <EmptyState text="Nothing resolved yet — outcomes backfill 12 trading days after each breakout." />
          ) : filteredResolved.length === 0 ? (
            <EmptyState
              small
              text={
                q
                  ? `No ${reviewFilter} cases match "${search.trim()}".`
                  : reviewFilter === "successes"
                    ? `Engine successes: 0 of ${tabCounts.learnable} learnable cases so far — the engine's directional calls haven't landed yet. That's a data fact, not a bug; it IS the benchmark. See Everything (${tabCounts.everything}) for the full archive.`
                    : reviewFilter === "failures"
                      ? `Engine failures: 0 of ${tabCounts.learnable} learnable cases so far. See Everything (${tabCounts.everything}) for the full archive.`
                      : `Learnable is empty: of ${tabCounts.everything} resolved cases, none has BOTH a decisive engine call (accum/distrib, not neutral) AND a directional outcome (up/down, not chop) on trusted volume. Neutral verdicts and chop resolutions are excluded by design — they teach nothing. Open Everything (${tabCounts.everything}) to browse the full archive.`
              }
            />
          ) : (
            <ResolvedTable rows={filteredResolved} onReview={setReviewId} />
          )}
        </>
      )}

      {reviewId && <ReviewDrawer id={reviewId} onClose={() => setReviewId(null)} />}
      {chartId && <LiveChartDrawer id={chartId} onClose={() => setChartId(null)} />}
    </div>
  );
}

/* ── Section header — one consistent pattern ────────────────────────────── */

function SectionHeader({ icon, title, count, total, note, right }: {
  icon: React.ReactNode; title: string; count: number; total?: number; note: string; right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14.5, fontWeight: 600, color: "var(--text-1)" }}>
        {icon} {title}
      </span>
      <span style={{ ...mono, fontSize: 10, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--border-strong)", color: "var(--text-2)" }}>
        {total != null && total !== count ? `${count} of ${total}` : count}
      </span>
      <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{note}</span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

function EmptyState({ text, small }: { text: string; small?: boolean }) {
  return (
    <div className="card" style={{ padding: small ? 26 : 40, textAlign: "center", marginBottom: 30 }}>
      <Inbox size={18} strokeWidth={1.6} style={{ color: "var(--text-3)", marginBottom: 8 }} />
      <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0, maxWidth: 460, marginInline: "auto", lineHeight: 1.5 }}>{text}</p>
    </div>
  );
}

/* ── Resolved table — the reveal ────────────────────────────────────────── */

function ResolvedTable({ rows, onReview }: { rows: ResolvedRow[]; onReview: (id: string) => void }) {
  const th: React.CSSProperties = {
    ...mono, textAlign: "left", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase",
    color: "var(--text-3)", fontWeight: 500, padding: "10px 13px", borderBottom: "1px solid var(--border-subtle)",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { ...mono, padding: "10px 13px", color: "var(--text-2)", whiteSpace: "nowrap" };
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 30 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>Instrument</th>
            <th style={th}>Box</th>
            <th style={{ ...th, textAlign: "right" }}>Bars</th>
            <th style={{ ...th, textAlign: "right" }}>Context</th>
            <th style={th}>Test</th>
            <th style={th}>Broke out</th>
            <th style={th}>Outcome</th>
            <th style={th}>Your read</th>
            <th style={th}>Engine</th>
            <th style={th}>Blind</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-card-2, var(--border-subtle))")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{ borderBottom: "1px solid var(--border-faint, var(--border-subtle))", transition: "background 0.1s" }}
            >
              <td style={{ ...td, color: "var(--text-1)", fontWeight: 500 }}>
                {r.instrument}
                {SUSPECT_VOLUME.has(r.instrument) && (
                  <AlertTriangle size={11} strokeWidth={2} style={{ color: "var(--amber)", marginLeft: 5, verticalAlign: "-1px" }} aria-label="Yahoo volume unreliable" />
                )}
                {(() => {
                  const name = instrumentName(r.instrument);
                  const cfd = instrumentInfo(r.instrument)?.executeSymbol;
                  const extra = [
                    name !== r.instrument ? name : null,
                    cfd && cfd !== r.instrument ? cfd : null,
                  ].filter(Boolean).join(" · ");
                  return extra ? (
                    <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", fontWeight: 400, marginLeft: 6 }}>
                      {extra}
                    </span>
                  ) : null;
                })()}
              </td>
              <td style={td}>{boxFmt(r)}</td>
              <td style={{ ...td, textAlign: "right" }}>{r.barsInRange}</td>
              <td style={{ ...td, textAlign: "right" }}>{ctxFmt(r.contextPct)}</td>
              <td style={td}>{r.terminalTest}</td>
              <td style={td}>{day(r.breakoutDate)}</td>
              <td style={{ ...td, color: OUTCOME_COLOR[r.outcome] ?? "var(--text-2)", fontWeight: 500 }}>{r.outcome.toUpperCase()}</td>
              <VerdictCell verdict={r.traderVerdict} outcome={r.outcome} />
              <VerdictCell verdict={r.engineVerdict} outcome={r.outcome} />
              <td style={{ ...td, color: "var(--text-3)" }}>{r.loggedBlind ? "✓" : "seed"}</td>
              <td style={{ padding: "8px 13px" }}>
                <button
                  onClick={() => onReview(r.id)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px",
                    borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600,
                    fontFamily: "'Sora', sans-serif", background: "transparent",
                    color: "var(--text-1)", border: "1px solid var(--border-strong)",
                  }}
                >
                  <PlaySquare size={12} strokeWidth={2} />
                  Review
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VerdictCell({ verdict, outcome }: { verdict: string | null; outcome: string }) {
  if (!verdict) return <td style={{ ...mono, padding: "10px 13px", color: "var(--text-3)" }}>—</td>;
  const hit = verdictHits(verdict, outcome);
  return (
    <td style={{ ...mono, padding: "10px 13px", color: VERDICT_COLOR[verdict] ?? "var(--text-2)", whiteSpace: "nowrap" }}>
      {verdictLabel(verdict)}{" "}
      <span style={{ color: hit ? "var(--green)" : "var(--red)" }}>{hit ? "✓" : "✗"}</span>
    </td>
  );
}
